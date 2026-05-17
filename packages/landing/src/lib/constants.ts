// Single source of truth for repeated text, URLs, and mock data shown
// on the landing. Touch this file when the demo data changes, when a
// link rolls over, or when copy gets a final pass.

// ─── Brand ─────────────────────────────────────────────────────────
export const BRAND_NAME = "Sigill";

// ─── External URLs ─────────────────────────────────────────────────
export const GITHUB_URL = "https://github.com/vwakesahu/fhe-giftcards";
export const APP_URL = "https://app.sigill.store";
export const FHENIX_URL = "https://fhenix.io";

// Base Sepolia explorer addresses (from the monorepo README).
export const BASESCAN = {
  sigill:
    "https://sepolia.basescan.org/address/0x23A0EB16E5bb10c46D9653B5D6688cE965e30324",
  cUSDC:
    "https://sepolia.basescan.org/address/0xaFA944F1B5f929693f92Ee4445B441FA70953A2E",
  usdc: "https://sepolia.basescan.org/address/0xE29D70400026d77a790a8E483168B94D6E36424F",
};

// ─── Product mock data (matches packages/app/src/lib/contracts.ts) ─
export const PRODUCTS = [
  { id: 1, label: "Amazon US", face: 5, priceUsdc: 10 },
  { id: 2, label: "Amazon US", face: 10, priceUsdc: 15 },
  { id: 3, label: "Amazon US", face: 25, priceUsdc: 30 },
] as const;

// The buy-wizard mock arrives at the confirm step with #02 selected.
export const SELECTED_PRODUCT_ID = 2;

// Demo relay address shown in the Sealed envelope row.
export const RELAY_ADDR = "0x7a3f…b201";

// Demo order shown in the reveal section.
export const DEMO_ORDER_ID = 142;
export const DEMO_PAID_CUSDC = "15.00 cUSDC";

// The gift card code that scrambles in. Kept here so any future product
// page or shareable preview reuses the same string.
export const DEMO_CODE = "AMZN 7K3F 9Q2P X4D8";

// ─── CTA labels ────────────────────────────────────────────────────
export const CTA_OPEN_APP = "Open Sigill";
export const CTA_OPEN_APP_SHORT = "Open app";
export const CTA_VIEW_GITHUB = "View on GitHub";
export const CTA_READ_GITHUB = "Read on GitHub";
