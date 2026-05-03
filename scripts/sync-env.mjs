#!/usr/bin/env node
// Read packages/contracts/deployments/base-sepolia.json and write the
// addresses into packages/{app,observer}/.env.local. Other keys are left
// alone — only NEXT_PUBLIC_*_ADDRESS / SIGILL_ADDRESS / CUSDC_ADDRESS /
// USDC_ADDRESS are touched. Idempotent.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

// Pull RPC from contracts .env so we can verify cUSDC.underlying() and avoid
// stale MockUSDC entries in the deployments JSON drifting away from what
// cUSDC actually wraps. Tiny home-grown parser to avoid a node_modules dep
// at the repo root (we run from `node scripts/sync-env.mjs`, not pnpm).
function loadDotenv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if (val.startsWith("#")) continue;
    val = val.replace(/^['"]|['"]$/g, "");
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadDotenv(join(root, "packages/contracts/.env"));

const depPath = join(root, "packages/contracts/deployments/base-sepolia.json");
if (!existsSync(depPath)) {
  console.error(`✗ ${depPath} not found — run \`make deploy\` first`);
  process.exit(1);
}
const dep = JSON.parse(readFileSync(depPath, "utf8"));

// Source-of-truth for the underlying token: ask cUSDC itself. The
// deployments JSON's MockUSDC entry is best-effort (deploy-sigill reuses an
// existing USDC_ADDRESS env, doesn't redeploy USDC) so it can drift.
async function readUnderlying(cusdc) {
  if (!cusdc) return null;
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
  // selector for `underlying()` = 0x6f307dc3
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: cusdc, data: "0x6f307dc3" }, "latest"],
    }),
  });
  const json = await res.json();
  if (!json.result || json.result === "0x") return null;
  // Last 20 bytes of the 32-byte word.
  return "0x" + json.result.slice(-40);
}

const truthUsdc = await readUnderlying(dep.ConfidentialERC20);
if (truthUsdc && dep.MockUSDC && truthUsdc.toLowerCase() !== dep.MockUSDC.toLowerCase()) {
  console.log(
    `  note: cUSDC.underlying() = ${truthUsdc} disagrees with deployments.MockUSDC = ${dep.MockUSDC} — using cUSDC.underlying()`,
  );
}
const usdcAddress = truthUsdc ?? dep.MockUSDC ?? null;

function update(path, kv) {
  let body = existsSync(path) ? readFileSync(path, "utf8") : "";
  for (const [k, v] of Object.entries(kv)) {
    if (!v) continue;
    const re = new RegExp(`^${k}=.*$`, "m");
    if (re.test(body)) body = body.replace(re, `${k}=${v}`);
    else body += (body && !body.endsWith("\n") ? "\n" : "") + `${k}=${v}\n`;
  }
  writeFileSync(path, body.replace(/\n+$/, "") + "\n");
  console.log(`  ${path.replace(root + "/", "")}`);
}

console.log("✓ syncing env files:");
update(join(root, "packages/app/.env.local"), {
  NEXT_PUBLIC_SIGILL_ADDRESS: dep.Sigill,
  NEXT_PUBLIC_CUSDC_ADDRESS: dep.ConfidentialERC20,
  NEXT_PUBLIC_USDC_ADDRESS: usdcAddress,
});
update(join(root, "packages/observer/.env.local"), {
  SIGILL_ADDRESS: dep.Sigill,
  CUSDC_ADDRESS: dep.ConfidentialERC20,
  USDC_ADDRESS: usdcAddress,
});

console.log(`\n  Sigill: ${dep.Sigill}`);
console.log(`  cUSDC:  ${dep.ConfidentialERC20}`);
console.log(`  USDC:   ${usdcAddress ?? "(unchanged)"}`);
