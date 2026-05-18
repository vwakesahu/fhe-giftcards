#!/usr/bin/env node
/**
 * Unwrap the Sigill protocol vault's sealed cUSDC balance into plaintext USDC.
 *
 * The vault is a 2-of-3 Safe at 0x37DFfFfB73b4A7eE6584F1ea56bac618c29c6882.
 * Two of its owner private keys are needed to satisfy the threshold.
 *
 * Flow:
 *   1. Initialise @cofhe/sdk with one of the owner keys as the API signer,
 *      and bind the encrypted input to the Safe address via setAccount().
 *      The verifier signs the proof for sender=safe; at execTransaction time
 *      msg.sender will be the Safe, so the on-chain verifier check passes.
 *   2. Encrypt the requested amount (cUSDC base units, 6 decimals) as InEuint64.
 *   3. Build a Safe v1.4 execTransaction calling cUSDC.requestUnwrap(encAmount).
 *   4. Sign the Safe tx hash with both owner keys; concat signatures sorted
 *      by signer address (Safe spec).
 *   5. Submit execTransaction from any wallet (owner1 here, gas-payer).
 *   6. The cUSDC.unwrapper EOA (currently obs1) listens for UnwrapRequested
 *      and finalises via claimUnwrap, transferring plaintext USDC to the Safe.
 *   7. Read USDC.balanceOf(safe) before vs after.
 *
 * Usage:
 *   SAFE_OWNER_KEY_1=0x...  SAFE_OWNER_KEY_2=0x...                          \
 *     node packages/contracts/scripts/unwrap-vault.mjs --amount=100000
 *
 * --amount is REQUIRED in cUSDC base units (6 decimals).
 *   - 100000   = 0.10  USDC
 *   - 175000   = 0.175 USDC (matches event-count estimate from query-vault-balance.mjs)
 *
 * If --amount exceeds the actual sealed balance, the contract's
 * _clampToBalance silently returns 0 and nothing transfers. Pick a value
 * <= the estimate, or run query-vault-balance.mjs first to see the count.
 */

import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenvConfig } from "dotenv";

import { createCofheConfig, createCofheClient } from "@cofhe/sdk/node";
import { Ethers6Adapter } from "@cofhe/sdk/adapters";
import { Encryptable } from "@cofhe/sdk";
import { chains } from "@cofhe/sdk/chains";

const here = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: join(here, "../.env") });

const VAULT = "0x37DFfFfB73b4A7eE6584F1ea56bac618c29c6882";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a, true];
  }),
);
// --amount=N: exact cUSDC base units to unwrap.
// --price-usdc=N: per-order quote price (default 10) used by the auto-estimator.
// --scan-blocks=N: how far back to scan deposits for the auto-estimator.
// If --amount is omitted, the script scans cUSDC Transfer→vault events and
// uses count × (price × 0.25%) as the unwrap amount. cUSDC._clampToBalance
// returns 0 when amount > balance, so we err on the side of slightly low if
// orders happened to use a higher quote price than --price-usdc.
const EXPLICIT_AMOUNT = args.amount ? BigInt(args.amount) : null;
const PRICE_USDC = BigInt(args["price-usdc"] ?? 10);
const SCAN_BLOCKS = BigInt(args["scan-blocks"] ?? 30_000);

const KEY1 = process.env.SAFE_OWNER_KEY_1 ?? process.env.PRIVATE_KEY;
const KEY2 = process.env.SAFE_OWNER_KEY_2;
if (!KEY1 || !KEY2) {
  console.error("set SAFE_OWNER_KEY_1 and SAFE_OWNER_KEY_2 in env");
  process.exit(1);
}

const dep = JSON.parse(
  readFileSync(join(here, "../deployments/base-sepolia.json"), "utf8"),
);
const CUSDC = dep.ConfidentialERC20;
const USDC = process.env.USDC_ADDRESS;

const provider = new ethers.JsonRpcProvider(
  process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
);
const owner1 = new ethers.Wallet(KEY1, provider);
const owner2 = new ethers.Wallet(KEY2, provider);

// ── Resolve the amount to unwrap ──
// Explicit --amount wins. Otherwise we auto-estimate the *current* sealed
// balance by netting deposits against previously-claimed unwrap amounts.
//
//   sealed_now ≈ (deposits × per-order-fee) - sum(UnwrapClaimed.amount for to=vault)
//
// UnwrapClaimed carries the plaintext amount the unwrapper submitted, so
// past withdrawals are fully readable. Without this subtraction, running
// the script twice in a row would estimate the same gross-deposit total and
// try to unwrap an already-empty balance.
const TRANSFER_TOPIC =
  "0x4853ae1b4d437c4255ac16cd3ceda3465975023f27cb141584cd9d44440fed82";
const UNWRAP_CLAIMED_TOPIC = ethers.id(
  "UnwrapClaimed(uint256,address,uint256)",
);
const padAddr = (a) =>
  "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");

async function chunkedGetLogs(address, topics, fromBlock, toBlock) {
  const out = [];
  const CHUNK = 2000n;
  let from = fromBlock;
  while (from <= toBlock) {
    const to = from + CHUNK > toBlock ? toBlock : from + CHUNK;
    const logs = await provider.getLogs({
      address,
      topics,
      fromBlock: Number(from),
      toBlock: Number(to),
    });
    out.push(...logs);
    from = to + 1n;
  }
  return out;
}

const fmtUsdc = (v) => {
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
};

let AMOUNT;
if (EXPLICIT_AMOUNT && EXPLICIT_AMOUNT > 0n) {
  AMOUNT = EXPLICIT_AMOUNT;
} else {
  const head = await provider.getBlockNumber();
  const start =
    BigInt(head) - SCAN_BLOCKS > 0n ? BigInt(head) - SCAN_BLOCKS : 0n;
  const [depositLogs, claimedLogs] = await Promise.all([
    chunkedGetLogs(CUSDC, [TRANSFER_TOPIC, null, padAddr(VAULT)], start, BigInt(head)),
    chunkedGetLogs(CUSDC, [UNWRAP_CLAIMED_TOPIC, null, padAddr(VAULT)], start, BigInt(head)),
  ]);
  const feePerOrder = (PRICE_USDC * 1_000_000n * 25n) / 10_000n;
  const deposited = feePerOrder * BigInt(depositLogs.length);
  let claimed = 0n;
  for (const log of claimedLogs) claimed += BigInt(log.data);
  AMOUNT = deposited > claimed ? deposited - claimed : 0n;
  if (AMOUNT === 0n) {
    console.log("Vault already drained — no sealed balance to unwrap.");
    process.exit(0);
  }
}

console.log(`Unwrapping ${fmtUsdc(AMOUNT)} USDC from vault…`);

// ── Safe v1.4.1 minimal ABI ──
const SAFE_ABI = [
  "function nonce() view returns (uint256)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)",
];

const safe = new ethers.Contract(VAULT, SAFE_ABI, provider);
const owners = await safe.getOwners();
const ownerSet = new Set(owners.map((o) => o.toLowerCase()));
if (!ownerSet.has(owner1.address.toLowerCase()) || !ownerSet.has(owner2.address.toLowerCase())) {
  throw new Error("one of the provided keys is not a Safe owner");
}

// Encrypt unwrap amount, bound to the Safe.
const cofheConfig = createCofheConfig({ supportedChains: [chains.baseSepolia] });
const cofheClient = createCofheClient(cofheConfig);
const { publicClient, walletClient } = await Ethers6Adapter(provider, owner1);
await cofheClient.connect(publicClient, walletClient);
const [encAmount] = await cofheClient
  .encryptInputs([Encryptable.uint64(AMOUNT)])
  .setAccount(VAULT)
  .execute();

const cUSDCIface = new ethers.Interface([
  "function requestUnwrap((uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature) encAmount) returns (uint256)",
  "event UnwrapRequested(uint256 indexed unwrapId, address indexed from, uint256 encAmountHandle)",
  "event UnwrapClaimed(uint256 indexed unwrapId, address indexed to, uint256 amount)",
]);
const data = cUSDCIface.encodeFunctionData("requestUnwrap", [
  [encAmount.ctHash, encAmount.securityZone, encAmount.utype, encAmount.signature],
]);

const ZERO = ethers.ZeroAddress;
const nonce = await safe.nonce();
const safeTxHash = await safe.getTransactionHash(CUSDC, 0n, data, 0, 0n, 0n, 0n, ZERO, ZERO, nonce);

const sig1 = owner1.signingKey.sign(safeTxHash);
const sig2 = owner2.signingKey.sign(safeTxHash);
const packSig = (s) => s.r.slice(2) + s.s.slice(2) + s.v.toString(16).padStart(2, "0");
const ordered =
  owner1.address.toLowerCase() < owner2.address.toLowerCase()
    ? [sig1, sig2]
    : [sig2, sig1];
const signatures = "0x" + ordered.map(packSig).join("");

const usdc = USDC
  ? new ethers.Contract(USDC, ["function balanceOf(address) view returns (uint256)"], provider)
  : null;
const before = usdc ? await usdc.balanceOf(VAULT) : 0n;

const tx = await new ethers.Contract(VAULT, SAFE_ABI, owner1).execTransaction(
  CUSDC, 0n, data, 0, 0n, 0n, 0n, ZERO, ZERO, signatures,
  { gasLimit: 1_500_000n },
);
console.log(`  tx: https://sepolia.basescan.org/tx/${tx.hash}`);
const receipt = await tx.wait();
if (receipt.status !== 1) throw new Error("Safe execTransaction reverted");

// Poll USDC balance until the unwrapper claims (or timeout).
const TIMEOUT_MS = 120_000;
const POLL_MS = 4_000;
const startedAt = Date.now();
let latest = before;
while (Date.now() - startedAt < TIMEOUT_MS) {
  latest = usdc ? await usdc.balanceOf(VAULT) : 0n;
  if (latest !== before) break;
  await new Promise((r) => setTimeout(r, POLL_MS));
}

if (latest === before) {
  console.warn("  timed out waiting for unwrapper to claim — check obs1 daemon is running");
} else {
  console.log(`  ✓ +${fmtUsdc(latest - before)} USDC arrived at vault`);
}
