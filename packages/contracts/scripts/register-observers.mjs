#!/usr/bin/env node
// Register observer #1 + #2 against the currently-deployed Sigill, but only
// if they aren't already bonded. Idempotent — safe to re-run.
//
// Reads OBSERVER_PRIVATE_KEY (#1) and OBSERVER_PRIVATE_KEY_2 (#2) from .env
// in this package directory. Skips a slot if its key is missing.

import { ethers } from "ethers";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenvConfig } from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
dotenvConfig({ path: join(pkgRoot, ".env") });

const depPath = join(pkgRoot, "deployments/base-sepolia.json");
if (!existsSync(depPath)) {
  console.error(`✗ ${depPath} missing — run \`make deploy\` first`);
  process.exit(1);
}
const dep = JSON.parse(readFileSync(depPath, "utf8"));
const sigillAddr = dep.Sigill;
if (!sigillAddr) {
  console.error("✗ Sigill address missing from deployments JSON");
  process.exit(1);
}

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const provider = new ethers.JsonRpcProvider(rpcUrl);

const slots = [
  { label: "observer #1", key: process.env.OBSERVER_PRIVATE_KEY },
  { label: "observer #2", key: process.env.OBSERVER_PRIVATE_KEY_2 },
];

const abi = [
  "function registerObserver() payable",
  "function getObserverBondAmount(address) view returns (uint256)",
  "function observerBond(address) view returns (uint256)",
];

const MIN = ethers.parseEther("0.01");

console.log(`✓ registering observers on Sigill ${sigillAddr}`);

for (const { label, key } of slots) {
  if (!key) {
    console.log(`  ${label}: no key set — skipping`);
    continue;
  }
  const wallet = new ethers.Wallet(key, provider);
  const sigill = new ethers.Contract(sigillAddr, abi, wallet);

  // New contracts expose getObserverBondAmount; fall back to the old public
  // mapping if we're talking to a pre-multi-observer Sigill.
  let bond = 0n;
  try {
    bond = await sigill.getObserverBondAmount(wallet.address);
  } catch {
    try {
      bond = await sigill.observerBond(wallet.address);
    } catch {
      // Both paths failed — let the registerObserver call fail loudly below.
    }
  }
  const bondEth = ethers.formatEther(bond);
  console.log(`  ${label} ${wallet.address} bond=${bondEth} ETH`);

  if (bond >= MIN) {
    console.log(`    ✓ already bonded`);
    continue;
  }

  // Sanity: needs at least 0.01 ETH for bond + a bit for gas.
  const balance = await provider.getBalance(wallet.address);
  if (balance < MIN + ethers.parseEther("0.001")) {
    console.error(
      `    ✗ wallet has ${ethers.formatEther(balance)} ETH — needs ≥ 0.011 to bond + gas`,
    );
    process.exit(1);
  }

  const tx = await sigill.registerObserver({ value: MIN });
  console.log(`    registering… tx=${tx.hash}`);
  await tx.wait();
  console.log(`    ✓ bonded`);
}
