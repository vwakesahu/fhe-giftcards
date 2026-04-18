const RELOADLY_AUTH_URL = "https://auth.reloadly.com/oauth/token";
const RELOADLY_SANDBOX_URL = "https://giftcards-sandbox.reloadly.com";

/** ProductId (as encoded on-chain) → Reloadly product mapping. */
export const PRODUCT_MAP: Record<number, { productId: number; label: string; unitPrice: number }> = {
  1: { productId: 5, label: "Amazon US $5", unitPrice: 5 },
  2: { productId: 5, label: "Amazon US $10", unitPrice: 10 },
  3: { productId: 5, label: "Amazon US $25", unitPrice: 25 },
};

let cachedToken: string | null = null;

async function getAccessToken(id: string, secret: string): Promise<string> {
  if (cachedToken) return cachedToken;
  const res = await fetch(RELOADLY_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: id,
      client_secret: secret,
      grant_type: "client_credentials",
      audience: RELOADLY_SANDBOX_URL,
    }),
  });
  if (!res.ok) throw new Error(`Reloadly auth failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string };
  cachedToken = data.access_token;
  return cachedToken;
}

/**
 * Hit Reloadly sandbox for an Amazon US code. Requires RELOADLY_CLIENT_ID and
 * RELOADLY_CLIENT_SECRET — throws if either is missing (no silent stubbing;
 * the observer must be configured correctly or refuse to fulfil).
 */
export async function purchaseGiftCard(productId: number, unitPrice: number, orderId: bigint): Promise<string> {
  const id = process.env.RELOADLY_CLIENT_ID;
  const secret = process.env.RELOADLY_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      "RELOADLY_CLIENT_ID and RELOADLY_CLIENT_SECRET are required — set them in .env.local",
    );
  }

  const token = await getAccessToken(id, secret);
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/com.reloadly.giftcards-v1+json",
    Authorization: `Bearer ${token}`,
  };

  console.log(`  [giftcard] ordering product ${productId} ($${unitPrice}) from Reloadly`);
  const orderRes = await fetch(`${RELOADLY_SANDBOX_URL}/orders`, {
    method: "POST",
    headers,
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
    const codeRes = await fetch(
      `${RELOADLY_SANDBOX_URL}/orders/transactions/${orderData.transactionId}/cards`,
      { headers },
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
