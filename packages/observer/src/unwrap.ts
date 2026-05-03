import { ethers } from "ethers";
import { Encryptable, FheTypes, type CofheClient, type CofheConfig } from "@cofhe/sdk";

import { config } from "./config";
import { CUsdcAbi } from "./abi";
import { ensureCofheInit } from "./cofhe";

/**
 * Observer / unwrapper cash-out utility.
 *
 *   pnpm tsx src/unwrap.ts                # unwrap the observer's whole sealed balance
 *   pnpm tsx src/unwrap.ts 10             # unwrap a specific amount (human USDC units)
 *   pnpm tsx src/unwrap.ts claim 11       # finalise a pending unwrap by id (operator duty)
 *
 * Trusted-unwrapper model: `requestUnwrap` debits the sealed balance and
 * grants the unwrapper decrypt permission on the debit handle. The unwrapper
 * then decrypts off-chain via @cofhe/sdk's `decryptForView` and submits the
 * plaintext via `claimUnwrap(id, plain)` — only `msg.sender == unwrapper`
 * can finalise.
 */

async function main() {
  const argv = process.argv.slice(2);
  const isClaim = argv[0] === "claim";

  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet = new ethers.Wallet(config.privateKey, provider);
  const cUSDC = new ethers.Contract(config.cUSDCAddress, CUsdcAbi, wallet);
  const usdcAddress = process.env.USDC_ADDRESS as `0x${string}` | undefined;
  const usdc = usdcAddress
    ? new ethers.Contract(
        usdcAddress,
        ["function balanceOf(address) view returns (uint256)"],
        wallet,
      )
    : null;

  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   Sigill — observer unwrap cUSDC → USDC       ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log(`  signer : ${wallet.address}`);
  console.log(`  cUSDC  : ${config.cUSDCAddress}`);

  // Sanity: this wallet must be the cUSDC unwrapper, otherwise claimUnwrap
  // reverts "Not unwrapper" regardless of how many pending unwraps exist.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const unwrapperOnChain: string = await (cUSDC as any).unwrapper();
  if (unwrapperOnChain.toLowerCase() !== wallet.address.toLowerCase()) {
    console.error(
      `\n  ✗ this wallet is not the authorised unwrapper\n    on-chain unwrapper: ${unwrapperOnChain}\n    this wallet:        ${wallet.address}`,
    );
    process.exit(1);
  }

  const client = await ensureCofheInit(wallet);

  if (isClaim) {
    const claimId = argv[1] ? BigInt(argv[1]) : undefined;
    if (claimId === undefined) throw new Error("Usage: pnpm unwrap claim <unwrapId>");
    const usdcBefore = usdc ? await usdc.balanceOf(wallet.address) : 0n;
    await claimPending(cUSDC, claimId, client);
    if (usdc) {
      const after = await usdc.balanceOf(wallet.address);
      console.log(`  USDC delta  : +${Number(after - usdcBefore) / 1e6} USDC`);
    }
    return;
  }

  // ── figure out amount ──
  const rawAmount = argv[0];
  let amountRaw: bigint;
  if (!rawAmount) {
    console.log("\n① Decrypting sealed balance to compute unwrap amount…");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handle: bigint = await (cUSDC as any).balanceOf(wallet.address);
    if (handle === 0n) {
      console.log("  nothing to unwrap — sealed balance is empty");
      return;
    }
    amountRaw = await decrypt(client, handle);
    console.log(`  sealed balance : ${Number(amountRaw) / 1e6} USDC\n`);
  } else {
    const human = Number(rawAmount);
    if (!Number.isFinite(human) || human <= 0) throw new Error(`Invalid amount: ${rawAmount}`);
    amountRaw = BigInt(Math.floor(human * 1_000_000));
    console.log(`  amount : ${human} USDC (${amountRaw} raw)\n`);
  }

  const usdcBefore = usdc ? await usdc.balanceOf(wallet.address) : 0n;
  if (usdc) console.log(`  USDC before : ${Number(usdcBefore) / 1e6}\n`);

  // ── requestUnwrap ──
  console.log("② Encrypting unwrap amount…");
  const [encAmount] = await client
    .encryptInputs([Encryptable.uint64(amountRaw)])
    .execute();

  console.log("③ Calling requestUnwrap…");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reqTx = await (cUSDC as any).requestUnwrap(encAmount);
  const reqReceipt: ethers.TransactionReceipt = await reqTx.wait();
  console.log(`  tx: ${reqTx.hash}`);
  console.log(`  ${config.explorer}/tx/${reqTx.hash}`);

  // Parse UnwrapRequested to get both the id and the debit handle in one
  // pass. Reading `pendingUnwraps(id)` immediately after the tx hits Base
  // Sepolia replica lag (seen it come back zero-address). Trust the event.
  const iface = cUSDC.interface;
  const log = reqReceipt.logs.find((l) => {
    try {
      return iface.parseLog({ topics: l.topics as string[], data: l.data })?.name === "UnwrapRequested";
    } catch {
      return false;
    }
  });
  if (!log) throw new Error("UnwrapRequested event missing from receipt");
  const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data })!;
  const unwrapId: bigint = parsed.args.unwrapId;
  const handle: bigint = BigInt(parsed.args.encAmountHandle);
  console.log(`  unwrapId: ${unwrapId}\n`);

  // ── claim immediately ──
  await claimWithHandle(cUSDC, unwrapId, handle, wallet.address, client);

  if (usdc) {
    // Base Sepolia replicas lag behind the sequencer for a few seconds after
    // a tx lands — if we read right away balanceOf returns the pre-transfer
    // value. Poll until it moves or we hit the ceiling.
    const after = await waitForBalanceChange(usdc, wallet.address, usdcBefore);
    console.log(`\n  USDC after  : ${Number(after) / 1e6}`);
    console.log(`  delta       : +${Number(after - usdcBefore) / 1e6} USDC`);
  }
}

/**
 * Finalise when we already know the debit handle (from the UnwrapRequested
 * event) — avoids a `pendingUnwraps` round-trip that hits Base Sepolia
 * replica lag right after the request tx lands.
 */
async function claimWithHandle(
  cUSDC: ethers.Contract,
  unwrapId: bigint,
  handle: bigint,
  recipient: string,
  client: CofheClient<CofheConfig>,
) {
  console.log(`④ Decrypting debit handle for unwrap #${unwrapId}…`);
  const plain = await decrypt(client, handle);
  console.log(`  recipient : ${recipient}`);
  console.log(`  plain     : ${Number(plain) / 1e6} USDC`);

  console.log("⑤ Calling claimUnwrap(id, plain)…");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const claimTx = await (cUSDC as any).claimUnwrap(unwrapId, plain);
  await claimTx.wait();
  console.log(`  claimed! tx: ${claimTx.hash}`);
  console.log(`  ${config.explorer}/tx/${claimTx.hash}`);
}

/**
 * Claim an existing pending unwrap by id (used for the `claim <id>` path,
 * where we don't have the event in hand). Retries the read a few times to
 * survive Base Sepolia replica lag.
 */
async function claimPending(
  cUSDC: ethers.Contract,
  unwrapId: bigint,
  client: CofheClient<CofheConfig>,
) {
  let recipient = ethers.ZeroAddress;
  let handle = 0n;
  let claimed = false;
  for (let i = 1; i <= 10; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pending = await (cUSDC as any).pendingUnwraps(unwrapId);
    recipient = pending.recipient ?? pending[0];
    handle = BigInt(pending.encAmount ?? pending[1]);
    claimed = pending.claimed ?? pending[2];
    if (recipient !== ethers.ZeroAddress) break;
    if (i < 10) {
      console.log(`  RPC replica catching up… (${i}/10)`);
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
  if (recipient === ethers.ZeroAddress) throw new Error(`unknown unwrapId ${unwrapId}`);
  if (claimed) {
    console.log("  already claimed — nothing to do");
    return;
  }
  await claimWithHandle(cUSDC, unwrapId, handle, recipient, client);
}

/**
 * Poll `balanceOf` through the RPC proxy until it differs from the snapshot
 * we took before the tx. Bounded retry — if it never moves (e.g. plain was
 * 0 because of clamping), we return the latest read so the caller can still
 * report delta=0 accurately.
 */
async function waitForBalanceChange(
  usdc: ethers.Contract,
  account: string,
  before: bigint,
  maxTries = 15,
  delayMs = 2_000,
): Promise<bigint> {
  let latest = before;
  for (let i = 0; i < maxTries; i++) {
    latest = await usdc.balanceOf(account);
    if (latest !== before) return latest;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return latest;
}

async function decrypt(
  client: CofheClient<CofheConfig>,
  handle: bigint,
): Promise<bigint> {
  for (let i = 1; i <= 10; i++) {
    try {
      const result = await client
        .decryptForView(handle, FheTypes.Uint64)
        .withPermit()
        .execute();
      if (result !== undefined && result !== null) return result as bigint;
    } catch {
      // CoFHE returns "not yet decrypted" while threshold network is processing
    }
    if (i < 10) await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error("decryption still pending after 30s — try again in a moment");
}

main().catch((err) => {
  console.error("[unwrap] fatal:", err);
  process.exit(1);
});
