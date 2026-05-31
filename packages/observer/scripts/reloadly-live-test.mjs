#!/usr/bin/env node
/**
 * Reloadly LIVE gift-card test (production endpoint, real money).
 *
 *   node scripts/reloadly-live-test.mjs                                   # discovery only
 *   node scripts/reloadly-live-test.mjs --search=amazon --country=US      # filter products
 *   node scripts/reloadly-live-test.mjs --buy --product=<id> --amount=1   # place a real $1 order
 *
 * Reads RELOADLY_LIVE_CLIENT_ID / RELOADLY_LIVE_CLIENT_SECRET (falls back to
 * RELOADLY_CLIENT_ID / RELOADLY_CLIENT_SECRET) from packages/observer/.env(.local).
 *
 * Discovery (auth + balance + product list) is read-only and free. The --buy
 * path hits POST /orders on the PRODUCTION endpoint and spends real balance.
 */

import { config as dotenvConfig } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, appendFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: join(here, "../.env.local") });
dotenvConfig({ path: join(here, "../.env") });

// Every API response in the buy path is appended here as it arrives, so a
// crash or timeout after the order settles never loses the card code.
const RECEIPTS_DIR = join(here, "../reloadly-receipts");
function persist(stage, payload) {
  try {
    mkdirSync(RECEIPTS_DIR, { recursive: true });
    const line = JSON.stringify({
      at: new Date().toISOString(),
      stage,
      payload,
    });
    appendFileSync(join(RECEIPTS_DIR, "live-test.log"), line + "\n");
  } catch (e) {
    console.error(`  [persist] failed to write receipt: ${e.message}`);
  }
}

const AUTH_URL = "https://auth.reloadly.com/oauth/token";
const LIVE_URL = "https://giftcards.reloadly.com";
const ACCEPT = "application/com.reloadly.giftcards-v1+json";

const CLIENT_ID =
  process.env.RELOADLY_LIVE_CLIENT_ID ?? process.env.RELOADLY_CLIENT_ID;
const CLIENT_SECRET =
  process.env.RELOADLY_LIVE_CLIENT_SECRET ?? process.env.RELOADLY_CLIENT_SECRET;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=?(.*)$/);
    return [m[1], m[2] === "" ? true : m[2]];
  }),
);
const DO_BUY = !!args.buy;
const PRODUCT = args.product ? Number(args.product) : null;
const AMOUNT = args.amount ? Number(args.amount) : 1;
const COUNTRY = (args.country ?? "US").toString();
const SEARCH = (args.search ?? "amazon").toString();
// Production /orders requires a senderName and emails the card to
// recipientEmail. Sandbox ignored both. Override via --sender= / --email=
// or RELOADLY_SENDER_NAME / RELOADLY_RECIPIENT_EMAIL.
const SENDER = (
  args.sender ??
  process.env.RELOADLY_SENDER_NAME ??
  "Sigill"
).toString();
const RECIPIENT_EMAIL = (
  args.email ??
  process.env.RELOADLY_RECIPIENT_EMAIL ??
  "vwakesahu@vwakesahu.com"
).toString();

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "Set RELOADLY_LIVE_CLIENT_ID + RELOADLY_LIVE_CLIENT_SECRET in packages/observer/.env",
  );
  process.exit(1);
}

async function auth() {
  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "client_credentials",
      audience: LIVE_URL,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `auth failed ${res.status}: ${await res.text()}\n` +
        "If this is INVALID_CREDENTIALS, the keys are likely sandbox keys, " +
        "not Live. Switch the Reloadly dashboard to Live mode and copy those.",
    );
  }
  return (await res.json()).access_token;
}

const token = await auth();
const H = {
  Accept: ACCEPT,
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};
console.log("✓ authenticated against PRODUCTION (giftcards.reloadly.com)");

// Account balance — confirms there's real money to spend.
const balRes = await fetch(`${LIVE_URL}/accounts/balance`, { headers: H });
if (balRes.ok) {
  const bal = await balRes.json();
  console.log(`  balance: ${bal.balance} ${bal.currencyCode}`);
} else {
  console.log(`  balance: (couldn't read — ${balRes.status})`);
}

// Find products matching the search term in the target country.
const prodRes = await fetch(
  `${LIVE_URL}/products?productName=${encodeURIComponent(
    SEARCH,
  )}&countryCode=${COUNTRY}&size=50`,
  { headers: H },
);
const prodJson = await prodRes.json();
const products = prodJson.content ?? (Array.isArray(prodJson) ? prodJson : []);
console.log(`\nProducts matching "${SEARCH}" in ${COUNTRY}:`);
if (products.length === 0) {
  console.log("  (none — try --search= a different term or --country=)");
}
for (const p of products) {
  const denom =
    p.denominationType === "FIXED"
      ? `FIXED [${(p.fixedRecipientDenominations || []).join(", ")}]`
      : `RANGE ${p.minRecipientDenomination}–${p.maxRecipientDenomination}`;
  const dollarOk =
    p.denominationType === "FIXED"
      ? (p.fixedRecipientDenominations || []).includes(AMOUNT)
      : AMOUNT >= p.minRecipientDenomination &&
        AMOUNT <= p.maxRecipientDenomination;
  console.log(
    `  #${p.productId}  ${p.productName}  ${denom}  ${p.recipientCurrencyCode}` +
      `  ${dollarOk ? `← $${AMOUNT} OK` : ""}`,
  );
}

if (!DO_BUY) {
  console.log(
    `\nDiscovery only. To buy: --buy --product=<id> --amount=${AMOUNT}\n` +
      `Or try several until one issues: --buy --products=20501,18747,20308`,
  );
  process.exit(0);
}

// Build the candidate list. --products=a,b,c takes precedence; else single --product.
const candidates = args.products
  ? args.products
      .toString()
      .split(",")
      .map((s) => Number(s.trim()))
      .filter(Boolean)
  : PRODUCT
    ? [PRODUCT]
    : [];
if (candidates.length === 0) {
  console.error(
    "\n--buy requires --product=<id> or --products=<id,id,id>",
  );
  process.exit(1);
}

// Attempt one product. Returns true on a real card issue, false otherwise
// (Reloadly auto-refunds the $1 on a sourcing failure, so a false is free).
async function tryProduct(productId) {
  console.log(`\n→ product ${productId}: placing $${AMOUNT} ${COUNTRY} order…`);
  const orderBody = {
    productId,
    countryCode: COUNTRY,
    quantity: 1,
    unitPrice: AMOUNT,
    senderName: SENDER,
    customIdentifier: `sigill-livetest-${productId}-${Date.now()}`,
  };
  if (RECIPIENT_EMAIL) orderBody.recipientEmail = RECIPIENT_EMAIL;

  const orderRes = await fetch(`${LIVE_URL}/orders`, {
    method: "POST",
    headers: H,
    body: JSON.stringify(orderBody),
  });
  if (!orderRes.ok) {
    const body = await orderRes.text();
    persist("order_failed", { productId, status: orderRes.status, body });
    console.log(`  ✗ ${orderRes.status} — Reloadly couldn't source it (auto-refunds). Next.`);
    return false;
  }
  const order = await orderRes.json();
  persist("order", order);
  console.log(`  txn #${order.transactionId} (${order.status}) — polling for card…`);

  for (let i = 0; i < 12; i++) {
    const cardRes = await fetch(
      `${LIVE_URL}/orders/transactions/${order.transactionId}/cards`,
      { headers: H },
    );
    if (cardRes.ok) {
      const cards = await cardRes.json();
      if (cards.length && cards[0].cardNumber) {
        persist("cards", { productId, transactionId: order.transactionId, cards });
        const code = cards[0].pinCode
          ? `${cards[0].cardNumber}-${cards[0].pinCode}`
          : cards[0].cardNumber;
        console.log(`\n✓ CARD ISSUED (product ${productId}): ${code}`);
        console.log(`  saved to: ${join(RECEIPTS_DIR, "live-test.log")}`);
        return true;
      }
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  persist("cards_timeout", { productId, transactionId: order.transactionId });
  console.log(`  card not ready after ~30s for txn #${order.transactionId} — saved, may settle later`);
  return false;
}

console.log(`Trying ${candidates.length} product(s) in sequence: ${candidates.join(", ")}`);
let issued = false;
for (const productId of candidates) {
  if (await tryProduct(productId)) {
    issued = true;
    break;
  }
}
if (!issued) {
  console.log(
    `\nNone issued. All charges auto-refund on sourcing failure — check the payments report.\n` +
      `Receipts: ${join(RECEIPTS_DIR, "live-test.log")}`,
  );
  process.exit(1);
}
