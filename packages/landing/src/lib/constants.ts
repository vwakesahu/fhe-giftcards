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
    "https://sepolia.basescan.org/address/0xb302566eA948f2039Cf6f8a30719F56a93e49Ab4",
  cUSDC:
    "https://sepolia.basescan.org/address/0x285b239fc9fE8B100d0Cb865cb44BdB166f81977",
  usdc: "https://sepolia.basescan.org/address/0xe29d70400026d77a790a8e483168b94d6e36424f",
};

// ─── Product mock data (matches packages/app/src/lib/contracts.ts) ─
// Only App Store is live right now. The rest are display-only in the picker
// (rendered greyed with "Coming soon") so the mock reflects that visually.
export const PRODUCTS = [
  { id: 1, label: "App Store & iTunes", face: 2, priceUsdc: 2, comingSoon: false },
  { id: 2, label: "Netflix", face: 20, priceUsdc: 20, comingSoon: true },
  { id: 3, label: "Spotify", face: 10, priceUsdc: 10, comingSoon: true },
] as const;

// Brand strip rendered above the buy-wizard mock — a quick visual answer to
// "which brands does this support". Order matters; App Store is "Live now",
// the rest are "Coming soon".
export const SUPPORTED_BRANDS = [
  { name: "App Store & iTunes", icon: "https://cdn.simpleicons.org/apple/white", live: true },
  { name: "Netflix", icon: "https://cdn.simpleicons.org/netflix/E50914" },
  { name: "Spotify", icon: "https://cdn.simpleicons.org/spotify/1DB954" },
  { name: "Google Play", icon: "https://cdn.simpleicons.org/googleplay/white" },
  { name: "Xbox Live", icon: "/xbox.png" },
  { name: "PlayStation", icon: "https://cdn.simpleicons.org/playstation/0070D1" },
  { name: "Steam", icon: "https://cdn.simpleicons.org/steam/white" },
  { name: "Roblox", icon: "https://cdn.simpleicons.org/roblox/white" },
] as const;

// The buy-wizard mock arrives at the confirm step with App Store selected.
export const SELECTED_PRODUCT_ID = 1;

// Demo relay address shown in the Sealed envelope row.
export const RELAY_ADDR = "0xc637…50FC";

// Demo order shown in the reveal section. Matches a real live-test card we
// minted against Reloadly production for the App Store $2 product.
export const DEMO_ORDER_ID = 142;
export const DEMO_PAID_CUSDC = "2.505 cUSDC";

// The gift card code that scrambles in. Kept here so any future product
// page or shareable preview reuses the same string.
export const DEMO_CODE = "X8D5 WDV9 CQ24 V6XW";

// ─── CTA labels ────────────────────────────────────────────────────
export const CTA_OPEN_APP = "Open Sigill";
export const CTA_OPEN_APP_SHORT = "Open app";
export const CTA_VIEW_GITHUB = "View on GitHub";
export const CTA_READ_GITHUB = "Read on GitHub";
