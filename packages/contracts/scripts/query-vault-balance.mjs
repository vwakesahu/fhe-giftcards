#!/usr/bin/env node
/**
 * Read-only vault balance estimator.
 *
 *   pnpm exec node packages/contracts/scripts/query-vault-balance.mjs
 *
 * The Sigill protocol vault is a Safe at 0x37DFfFfB73b4A7eE6584F1ea56bac618c29c6882.
 * Every fulfilled order deposits 0.25% of the buyer's quoted card price into
 * the vault as a sealed cUSDC balance update. Both the deposit amount and
 * the running balance are FHE-encrypted; the Safe is the only ACL holder, so
 * decryption is not possible from this script.
 *
 * What this script CAN do:
 *   1. Confirm the vault has been credited (balance handle != 0).
 *   2. Count every cUSDC.Transfer event with to=vault on the current Sigill
 *      deploy. Each event = one fulfilled order = one fee deposit.
 *   3. Estimate the cumulative value assuming all orders were at the demo
 *      price ($10 = 10_000_000 base units), which is what the running daemon
 *      issues. Override with --price-usdc=<N> for a different assumption.
 *
 * What it CANNOT do:
 *   - Decrypt the actual sealed balance. To get the exact plaintext you need
 *     to unwrap via a Safe transaction (see "Unwrap path" footer below).
 */

import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenvConfig } from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: join(here, "../.env") });

const VAULT = "0x37DFfFfB73b4A7eE6584F1ea56bac618c29c6882";
// cUSDC's non-standard Transfer(address,address) signature hash. Not the
// canonical ERC-20 Transfer hash — the value field is absent because amounts
// are encrypted.
const TRANSFER_TOPIC =
  "0x4853ae1b4d437c4255ac16cd3ceda3465975023f27cb141584cd9d44440fed82";
// Base Sepolia public RPC caps eth_getLogs at 2000 blocks.
const RPC_LOG_CHUNK = 2000;
// Per-order platform fee assumption (cUSDC base units, 6 decimals).
// Default = 25_000 = 0.025 USDC, which is 0.25% of a 10 USDC quote.
function platformFeePerOrder(priceUsdcBase) {
  // mirrors Observer.sol's _quoteOrder: (price * 25) / 10000
  return (priceUsdcBase * 25n) / 10_000n;
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a, true];
  }),
);
const PRICE_USDC = BigInt(args["price-usdc"] ?? 10);
const SCAN_BLOCKS = BigInt(args["scan-blocks"] ?? 20_000);

const deployments = JSON.parse(
  readFileSync(join(here, "../deployments/base-sepolia.json"), "utf8"),
);
const SIGILL = deployments.Sigill;
const CUSDC = deployments.ConfidentialERC20;

const provider = new ethers.JsonRpcProvider(
  process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
);

const padAddr = (a) =>
  "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");

console.log("╔══════════════════════════════════════════════════════╗");
console.log("║   Sigill — protocol vault balance estimator          ║");
console.log("╚══════════════════════════════════════════════════════╝");
console.log(`  vault   : ${VAULT}`);
console.log(`  Sigill  : ${SIGILL}`);
console.log(`  cUSDC   : ${CUSDC}`);
console.log();

// 1) Encrypted balance handle.
const cUSDC = new ethers.Contract(
  CUSDC,
  ["function balanceOf(address) view returns (uint256)"],
  provider,
);
const handle = await cUSDC.balanceOf(VAULT);
console.log("① Sealed balance handle (encrypted, unreadable from outside):");
console.log(`    ${handle.toString()}`);
console.log(
  `    → ${handle === 0n ? "ZERO HANDLE (vault never credited)" : "non-zero (vault holds an encrypted balance)"}`,
);
console.log();

if (handle === 0n) {
  console.log(
    "Nothing to estimate — no Transfer→vault events expected either.",
  );
  process.exit(0);
}

// 2) Count Transfer→vault events on cUSDC. RPC has a 2000-block cap, so chunk.
const head = await provider.getBlockNumber();
const start = BigInt(head) - SCAN_BLOCKS > 0n ? BigInt(head) - SCAN_BLOCKS : 0n;
console.log(
  `② Scanning cUSDC.Transfer events with to=vault, blocks ${start}..${head}…`,
);

const deposits = [];
let from = start;
while (from <= BigInt(head)) {
  const to = from + BigInt(RPC_LOG_CHUNK) > BigInt(head) ? BigInt(head) : from + BigInt(RPC_LOG_CHUNK);
  const logs = await provider.getLogs({
    address: CUSDC,
    topics: [TRANSFER_TOPIC, null, padAddr(VAULT)],
    fromBlock: Number(from),
    toBlock: Number(to),
  });
  deposits.push(...logs);
  from = to + 1n;
}
console.log(`    ${deposits.length} platform-fee deposits found`);
if (deposits.length > 0) {
  console.log(`    first: block ${deposits[0].blockNumber}  tx ${deposits[0].transactionHash}`);
  console.log(`    last : block ${deposits.at(-1).blockNumber}  tx ${deposits.at(-1).transactionHash}`);
}
console.log();

// 3) Estimate cumulative value under the constant-price assumption.
const priceBase = PRICE_USDC * 1_000_000n;
const feePerOrder = platformFeePerOrder(priceBase);
const estimatedTotal = feePerOrder * BigInt(deposits.length);
const fmt = (v) => {
  const whole = v / 1_000_000n;
  const frac = v % 1_000_000n;
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
};
