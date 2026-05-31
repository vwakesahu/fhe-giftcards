const RELOADLY_AUTH_URL = "https://auth.reloadly.com/oauth/token";

// Reloadly has two environments behind separate audiences + credentials.
// RELOADLY_ENV=live → real money, real cards. anything else → sandbox.
function reloadlyEnv(): "sandbox" | "live" {
  const v = (process.env.RELOADLY_ENV ?? "").toLowerCase();
  return v === "live" || v === "production" ? "live" : "sandbox";
}
const RELOADLY_API_URL =
  reloadlyEnv() === "live"
    ? "https://giftcards.reloadly.com"
    : "https://giftcards-sandbox.reloadly.com";

function reloadlyClientId(): string | undefined {
  return reloadlyEnv() === "live"
    ? process.env.RELOADLY_LIVE_CLIENT_ID ?? process.env.RELOADLY_CLIENT_ID
    : process.env.RELOADLY_CLIENT_ID;
}
function reloadlyClientSecret(): string | undefined {
  return reloadlyEnv() === "live"
    ? process.env.RELOADLY_LIVE_CLIENT_SECRET ?? process.env.RELOADLY_CLIENT_SECRET
    : process.env.RELOADLY_CLIENT_SECRET;
}

/** ProductId (as encoded on-chain) → Reloadly product mapping.
 *  Live and sandbox use different Reloadly product IDs, so we pick at boot
 *  based on RELOADLY_ENV. Coming-soon brands in the dApp (Netflix, Spotify
 *  etc.) deliberately don't appear here — their on-chain product slots
 *  (productActive[2..8]) are not set, so quoteOrder would revert before the
 *  observer ever sees them. Add them here when their slots get activated.  */
const PRODUCT_MAP_LIVE: Record<number, { productId: number; label: string; unitPrice: number }> = {
  1: { productId: 21, label: "App Store & iTunes $2", unitPrice: 2 },
};
const PRODUCT_MAP_SANDBOX: Record<number, { productId: number; label: string; unitPrice: number }> = {
  1: { productId: 5, label: "Sandbox test card $2", unitPrice: 2 },
};
export const PRODUCT_MAP =
  reloadlyEnv() === "live" ? PRODUCT_MAP_LIVE : PRODUCT_MAP_SANDBOX;

// Reloadly OAuth tokens have a TTL (~24h). Without expiry tracking the daemon
// caches a token forever and starts 401-ing after the first day of uptime.
// We track wall-clock expiry from the auth response's `expires_in` and
// proactively refresh 5 min before; `purchaseGiftCard` also catches 401 and
// force-refreshes once as a backstop.
let cachedToken: string | null = null;
let tokenExpiresAt = 0; // unix ms; 0 ⇒ no token / forced refresh
const REFRESH_LEAD_MS = 5 * 60 * 1000;

async function getAccessToken(id: string, secret: string, forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && Date.now() < tokenExpiresAt - REFRESH_LEAD_MS) {
    return cachedToken;
  }
  const res = await fetch(RELOADLY_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: id,
      client_secret: secret,
      grant_type: "client_credentials",
      // audience must match the env: sandbox creds + sandbox audience, live
      // creds + live audience. Mismatch returns 401 INVALID_CREDENTIALS.
      audience: RELOADLY_API_URL,
    }),
  });
  if (!res.ok) throw new Error(`Reloadly auth failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  cachedToken = data.access_token;
  // Default to 1h if Reloadly doesn't echo expires_in (paranoid floor).
  const ttlSec = typeof data.expires_in === "number" ? data.expires_in : 3600;
  tokenExpiresAt = Date.now() + ttlSec * 1000;
  return cachedToken;
}

/**
 * Hit Reloadly sandbox for an Amazon US code. Requires RELOADLY_CLIENT_ID and
 * RELOADLY_CLIENT_SECRET — throws if either is missing (no silent stubbing;
 * the observer must be configured correctly or refuse to fulfil).
 */
export async function purchaseGiftCard(productId: number, unitPrice: number, orderId: bigint): Promise<string> {
  const id = reloadlyClientId();
  const secret = reloadlyClientSecret();
  if (!id || !secret) {
    throw new Error(
      `Reloadly creds missing for env=${reloadlyEnv()}. ` +
        `Live needs RELOADLY_LIVE_CLIENT_ID + RELOADLY_LIVE_CLIENT_SECRET; ` +
        `sandbox needs RELOADLY_CLIENT_ID + RELOADLY_CLIENT_SECRET.`,
    );
  }

  const headersFor = (token: string) => ({
    "Content-Type": "application/json",
    Accept: "application/com.reloadly.giftcards-v1+json",
    Authorization: `Bearer ${token}`,
  });

  // Tiny helper: fetch, and on 401 refresh the token + retry once. Works for
  // both the order-place call and the subsequent card-poll calls.
  async function reloadlyFetch(url: string, init?: RequestInit): Promise<Response> {
    let token = await getAccessToken(id!, secret!);
    let res = await fetch(url, { ...init, headers: { ...headersFor(token), ...(init?.headers ?? {}) } });
    if (res.status === 401) {
      token = await getAccessToken(id!, secret!, true);
      res = await fetch(url, { ...init, headers: { ...headersFor(token), ...(init?.headers ?? {}) } });
    }
    return res;
  }

  console.log(`  [giftcard] ordering product ${productId} ($${unitPrice}) from Reloadly (${reloadlyEnv()})`);
  const orderRes = await reloadlyFetch(`${RELOADLY_API_URL}/orders`, {
    method: "POST",
    body: JSON.stringify({
      productId,
      countryCode: "US",
      quantity: 1,
      unitPrice,
      customIdentifier: `sigill-${orderId}-${Date.now()}`,
    }),
  });
  if (!orderRes.ok) {
    throw new Error(`Reloadly order failed: ${orderRes.status} ${await orderRes.text()}`);
  }
  const orderData = (await orderRes.json()) as { transactionId: number; status: string };
  console.log(`  [giftcard] Reloadly txn #${orderData.transactionId} (${orderData.status})`);

  for (let i = 0; i < 10; i++) {
    const codeRes = await reloadlyFetch(
      `${RELOADLY_API_URL}/orders/transactions/${orderData.transactionId}/cards`,
    );
    if (codeRes.ok) {
      const cards = (await codeRes.json()) as { cardNumber?: string; pinCode?: string }[];
      if (cards.length > 0 && cards[0].cardNumber) {
        return cards[0].pinCode
          ? `${cards[0].cardNumber}-${cards[0].pinCode}`
          : cards[0].cardNumber;
      }
    }
    if (i < 9) await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Failed to retrieve gift card code from Reloadly");
}
