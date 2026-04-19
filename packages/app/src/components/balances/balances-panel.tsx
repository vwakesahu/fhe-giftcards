"use client";

import { useState } from "react";
import {
  useAccount,
  useReadContract,
  usePublicClient,
  useWalletClient,
} from "wagmi";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { decodeEventLog } from "viem";
import {
  ArrowDown,
  Check,
  Droplet,
  Eye,
  EyeOff,
  Lock,
  RefreshCw,
} from "lucide-react";

import { addresses, cUSDCAbi, usdcAbi } from "@/lib/contracts";
import { CUsdcIcon, UsdcIcon } from "@/components/icons";
import { Spinner } from "@/components/spinner";
import { ensureCofheInit, getCofhejs } from "@/lib/cofhe";
import { formatUsdc } from "@/lib/format";
import { EASE_OUT } from "@/lib/motion";

const QUICK = [25, 50, 100, 500];
const MINT_AMOUNT = 1000n * 1_000_000n;

type Revealed = { handle: bigint; value: bigint };

export function BalancesPanel() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [mode, setMode] = useState<"wrap" | "unwrap">("wrap");
  const [amount, setAmount] = useState<string>("50");
  const [wrapping, setWrapping] = useState(false);
  const [justWrapped, setJustWrapped] = useState(false);

  const [unwrapping, setUnwrapping] = useState(false);
  const [justUnwrapped, setJustUnwrapped] = useState(false);

  const [minting, setMinting] = useState(false);
  const [justMinted, setJustMinted] = useState(false);

  const [revealing, setRevealing] = useState(false);
  const [revealed, setRevealed] = useState<Revealed | null>(null);

  const [refreshingUsdc, setRefreshingUsdc] = useState(false);
  const [refreshingCUsdc, setRefreshingCUsdc] = useState(false);

  const { data: usdcBalance, refetch: refetchUsdc } = useReadContract({
    address: addresses.USDC,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 5_000 },
  });

  const { data: cUSDCHandle, refetch: refetchCUsdc } = useReadContract({
    address: addresses.cUSDC,
    abi: cUSDCAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 5_000 },
  });

  const amountNum = Number(amount);
  const amountRaw =
    Number.isFinite(amountNum) && amountNum > 0
      ? BigInt(Math.floor(amountNum * 1_000_000))
      : 0n;
  const handle = (cUSDCHandle as bigint | undefined) ?? 0n;
  const hasSealed = handle > 0n;
  const tooMuchUsdc = mode === "wrap" && amountRaw > (usdcBalance ?? 0n);
  const canSubmit =
    isConnected &&
    !wrapping &&
    !unwrapping &&
    (mode === "wrap" ? amountRaw > 0n && !tooMuchUsdc : hasSealed);

  // Drop stale reveal if the handle rotated (e.g. after a wrap)
  const currentReveal =
    revealed && revealed.handle === handle ? revealed : null;

  async function handleMint() {
    if (!address || !publicClient || !walletClient) return;
    try {
      setMinting(true);
      toast.message("Minting 1,000 USDC");
      const hash = await walletClient.writeContract({
        address: addresses.USDC,
        abi: usdcAbi,
        functionName: "mint",
        args: [address, MINT_AMOUNT],
        account: walletClient.account!,
        chain: walletClient.chain,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success")
        throw new Error("Mint reverted on-chain");
      toast.success("Minted 1,000 USDC");
      refetchUsdc();
      setJustMinted(true);
      setTimeout(() => setJustMinted(false), 2400);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message.slice(0, 100) : "Mint failed",
      );
    } finally {
      setMinting(false);
    }
  }

  async function handleReveal() {
    if (!publicClient || !walletClient || !hasSealed) return;
    try {
      setRevealing(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await ensureCofheInit(publicClient as any, walletClient);
      const { cofhejs, FheTypes } = await getCofhejs();
      let value: bigint | null = null;
      for (let i = 0; i < 10; i++) {
        const res = await cofhejs.unseal(handle, FheTypes.Uint64);
        if (res.data !== undefined && res.data !== null) {
          value = res.data as bigint;
          break;
        }
        await new Promise((r) => setTimeout(r, 2500));
      }
      if (value === null)
        throw new Error("Decryption still pending — try again in a bit");
      setRevealed({ handle, value });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message.slice(0, 120) : "Reveal failed",
      );
    } finally {
      setRevealing(false);
    }
  }

  async function handleWrap() {
    if (
      !address ||
      !publicClient ||
      !walletClient ||
      !canSubmit ||
      mode !== "wrap"
    )
      return;
    try {
      setWrapping(true);

      // Skip the approve tx when USDC allowance already covers this wrap —
      // saves a MetaMask popup + a full on-chain confirmation (4-8s). On the
      // first wrap we approve max so subsequent wraps are one-tx.
      const currentAllowance = (await publicClient.readContract({
        address: addresses.USDC,
        abi: usdcAbi,
        functionName: "allowance",
        args: [address, addresses.cUSDC],
      })) as bigint;

      if (currentAllowance < amountRaw) {
        toast.message("Approving USDC (one-time)");
        const MAX_UINT256 = (1n << 256n) - 1n;
        const approveHash = await walletClient.writeContract({
          address: addresses.USDC,
          abi: usdcAbi,
          functionName: "approve",
          args: [addresses.cUSDC, MAX_UINT256],
          account: walletClient.account!,
          chain: walletClient.chain,
        });
        const approveReceipt = await publicClient.waitForTransactionReceipt({
          hash: approveHash,
        });
        if (approveReceipt.status !== "success") {
          throw new Error("USDC approval reverted — try again");
        }
      }

      toast.message("Wrapping USDC → cUSDC");
      const wrapHash = await walletClient.writeContract({
        address: addresses.cUSDC,
        abi: cUSDCAbi,
        functionName: "wrap",
        args: [amountRaw],
        account: walletClient.account!,
        chain: walletClient.chain,
      });
      const wrapReceipt = await publicClient.waitForTransactionReceipt({
        hash: wrapHash,
      });
      if (wrapReceipt.status !== "success") {
        throw new Error("Wrap reverted — allowance likely not set, try again");
      }

      toast.success(`Wrapped ${amount} USDC`);
      refetchUsdc();
      refetchCUsdc();
      setJustWrapped(true);
      setTimeout(() => setJustWrapped(false), 2400);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message.slice(0, 120) : "Wrap failed",
      );
    } finally {
      setWrapping(false);
    }
  }

  async function handleUnwrap() {
    if (
      !address ||
      !publicClient ||
      !walletClient ||
      !canSubmit ||
      mode !== "unwrap"
    )
      return;
    try {
      setUnwrapping(true);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await ensureCofheInit(publicClient as any, walletClient);
      const { cofhejs, Encryptable, FheTypes } = await getCofhejs();

      // 0) Always unwrap the whole sealed balance. Fetch the latest handle
      //    (defeat replica lag), unseal to get the plaintext balance, then
      //    encrypt that exact value. Skips the "how much?" input entirely
      //    and avoids the `_clampToBalance` silent-zero trap from
      //    over-requesting.
      toast.message("Reading sealed balance");
      let latestHandle = handle;
      for (let i = 0; i < 4; i++) {
        const { data } = await refetchCUsdc();
        const next = data as bigint | undefined;
        if (next && next !== 0n) {
          latestHandle = next;
          break;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (!latestHandle || latestHandle === 0n) {
        throw new Error("No sealed balance to unwrap");
      }
      let sealedBalance: bigint | null = null;
      for (let i = 0; i < 10; i++) {
        const res = await cofhejs.unseal(latestHandle, FheTypes.Uint64);
        if (res.data !== undefined && res.data !== null) {
          sealedBalance = res.data as bigint;
          break;
        }
        await new Promise((r) => setTimeout(r, 2500));
      }
      if (sealedBalance === null) throw new Error("Could not read sealed balance — retry");
      if (sealedBalance === 0n) throw new Error("Sealed balance is 0 — nothing to unwrap");

      // 1) Encrypt the full sealed balance for requestUnwrap.
      toast.message(`Encrypting ${formatUsdc(sealedBalance, 2)} cUSDC`);
      const encRes = await cofhejs.encrypt([
        Encryptable.uint64(sealedBalance),
      ] as const);
      if (encRes.error || !encRes.data) throw new Error(String(encRes.error));
      const [encRaw] = encRes.data;
      const encAmount = {
        ...encRaw,
        signature: encRaw.signature as `0x${string}`,
      };

      // 2) Submit requestUnwrap; capture the debit handle from the event so
      //    we don't have to re-read pendingUnwraps (replica lag hits hard
      //    right after the tx lands).
      toast.message("Requesting unwrap");
      const reqHash = await walletClient.writeContract({
        address: addresses.cUSDC,
        abi: cUSDCAbi,
        functionName: "requestUnwrap",
        args: [encAmount],
        account: walletClient.account!,
        chain: walletClient.chain,
      });
      const reqReceipt = await publicClient.waitForTransactionReceipt({
        hash: reqHash,
      });
      if (reqReceipt.status !== "success")
        throw new Error("requestUnwrap reverted");

      const evt = reqReceipt.logs
        .map((l) => {
          try {
            return decodeEventLog({
              abi: cUSDCAbi,
              data: l.data,
              topics: l.topics,
            });
          } catch {
            return null;
          }
        })
        .find((d) => d?.eventName === "UnwrapRequested");
      if (!evt || !evt.args)
        throw new Error("UnwrapRequested event missing from receipt");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const args = evt.args as any;
      const unwrapId = args.unwrapId as bigint;
      const debitHandle = args.encAmountHandle as bigint;

      // 3) Unseal the debit handle off-chain (buyer has ACL per contract).
      toast.message("Unsealing debit");
      let plain: bigint | null = null;
      for (let i = 0; i < 10; i++) {
        const res = await cofhejs.unseal(debitHandle, FheTypes.Uint64);
        if (res.data !== undefined && res.data !== null) {
          plain = res.data as bigint;
          break;
        }
        await new Promise((r) => setTimeout(r, 2500));
      }
      if (plain === null)
        throw new Error("cofhejs.unseal pending — retry in a moment");

      // 4) Finalise. Either this wallet (recipient) or the observer may
      //    call claimUnwrap; the observer daemon races us and whoever gets
      //    in first wins. Treat "already claimed" as success.
      //
      //    Short delay + forced account sync so MetaMask catches up on
      //    nonce/gas between the requestUnwrap mine and this send
      //    (cofhejs's EIP-712 signature in between perturbs its poll).
      //    Letting the wallet derive both values itself is more robust
      //    than passing an explicit nonce, which forces viem to also
      //    pre-compute gas and trips MetaMask's "gas price too low" gate.
      toast.message("Claiming unwrap");
      await publicClient.getTransactionCount({
        address: walletClient.account!.address,
        blockTag: "pending",
      });
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const claimHash = await walletClient.writeContract({
          address: addresses.cUSDC,
          abi: cUSDCAbi,
          functionName: "claimUnwrap",
          args: [unwrapId, plain],
          account: walletClient.account!,
          chain: walletClient.chain,
        });
        const claimReceipt = await publicClient.waitForTransactionReceipt({
          hash: claimHash,
        });
        if (claimReceipt.status !== "success")
          throw new Error("claimUnwrap reverted");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/already claimed/i.test(msg)) throw err;
        // Observer beat us to it — funds landed anyway.
      }

      const gained = (Number(plain) / 1e6).toFixed(2);
      toast.success(`Unwrapped ${gained} USDC`);
      refetchUsdc();
      refetchCUsdc();
      setJustUnwrapped(true);
      setTimeout(() => setJustUnwrapped(false), 2400);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message.slice(0, 140) : "Unwrap failed",
      );
    } finally {
      setUnwrapping(false);
    }
  }

  // Manual refresh with a short retry loop — Base Sepolia replicas lag for a
  // few seconds after a state change, so a single refetch often returns the
  // same cached value. We poll up to ~6s until the data changes, then give
  // up (the balance may genuinely not have moved).
  async function handleRefreshUsdc() {
    if (refreshingUsdc) return;
    setRefreshingUsdc(true);
    const before = usdcBalance as bigint | undefined;
    try {
      for (let i = 0; i < 4; i++) {
        const { data } = await refetchUsdc();
        if ((data as bigint | undefined) !== before) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
    } finally {
      setRefreshingUsdc(false);
    }
  }

  async function handleRefreshCUsdc() {
    if (refreshingCUsdc) return;
    setRefreshingCUsdc(true);
    const before = cUSDCHandle as bigint | undefined;
    try {
      // 1) Fetch the freshest handle, defeating replica lag.
      let latest: bigint | undefined = before;
      for (let i = 0; i < 4; i++) {
        const { data } = await refetchCUsdc();
        latest = data as bigint | undefined;
        if (latest !== before) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
      // 2) Auto-unhide: decrypt the new handle so `****` flips to the real
      //    number. This will prompt a wallet signature if cofhejs hasn't
      //    been initialised for this session yet.
      if (!latest || latest === 0n || !publicClient || !walletClient) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await ensureCofheInit(publicClient as any, walletClient);
      const { cofhejs, FheTypes } = await getCofhejs();
      for (let i = 0; i < 10; i++) {
        const res = await cofhejs.unseal(latest, FheTypes.Uint64);
        if (res.data !== undefined && res.data !== null) {
          setRevealed({ handle: latest, value: res.data as bigint });
          return;
        }
        await new Promise((r) => setTimeout(r, 2500));
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message.slice(0, 120) : "Refresh failed",
      );
    } finally {
      setRefreshingCUsdc(false);
    }
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: EASE_OUT }}
      >
        <h1 className="text-[20px] font-semibold tracking-[-0.01em] max-w-xl mx-auto">
          Balances
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground/70 leading-relaxed">
          Mint test USDC, then wrap it into sealed cUSDC to place orders.
        </p>
      </motion.div>

      {/* USDC row */}
      <motion.section
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.05, ease: EASE_OUT }}
        className="mt-7 rounded-2xl border border-white/6 p-5 relative"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <UsdcIcon size={36} />
            <div>
              <p className="text-[14px] font-medium leading-none">USDC</p>
              <p className="mt-1.5 text-[11.5px] text-muted-foreground/55 leading-none">
                public · test token
              </p>
            </div>
          </div>
          <div className="inline-flex items-center gap-2">
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={String(usdcBalance ?? "—")}
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.2, ease: EASE_OUT }}
                className="text-[22px] font-semibold tabular-nums leading-none"
              >
                {isConnected ? formatUsdc(usdcBalance, 2) : "—"}
              </motion.p>
            </AnimatePresence>
            <RefreshButton busy={refreshingUsdc} onClick={handleRefreshUsdc} />
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-white/4 flex items-center justify-between gap-3">
          <p className="text-[11.5px] text-muted-foreground/55">
            Claim 1,000 USDC from the faucet. Capped per call.
          </p>
          <MintButton
            onClick={handleMint}
            busy={minting}
            justMinted={justMinted}
            disabled={!isConnected}
          />
        </div>
      </motion.section>

      {/* Flow arrow — overlaps the boundary between the two cards */}
      <div className="relative h-0 z-10 flex items-center justify-center pointer-events-none">
        <div className="size-10 rounded-full bg-background border border-white/10 flex items-center justify-center shadow-sm">
          <ArrowDown className="size-4 text-sp" strokeWidth={2.2} />
        </div>
      </div>

      {/* cUSDC row */}
      <motion.section
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.1, ease: EASE_OUT }}
        className="rounded-2xl border border-white/6 p-5 relative"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <CUsdcIcon size={36} />
            <div>
              <p className="text-[14px] font-medium leading-none">cUSDC</p>
              <p className="mt-1.5 text-[11.5px] text-muted-foreground/55 leading-none">
                sealed · Fhenix FHE
              </p>
            </div>
          </div>
          <div className="inline-flex items-center gap-2">
            <RevealedBalance
              isConnected={isConnected}
              hasSealed={hasSealed}
              revealed={currentReveal?.value ?? null}
              revealing={revealing}
              onReveal={handleReveal}
              onHide={() => setRevealed(null)}
            />
            <RefreshButton
              busy={refreshingCUsdc}
              onClick={handleRefreshCUsdc}
            />
          </div>
        </div>

        {/* Wrap / Unwrap form */}
        <div className="mt-4 pt-4 border-t border-white/4">
          <div className="flex items-center justify-between gap-3">
            <ModeToggle
              mode={mode}
              onChange={setMode}
              disabled={wrapping || unwrapping}
            />
            {mode === "wrap" && (
              <div className="flex items-center gap-1">
                {QUICK.map((v) => (
                  <button
                    key={v}
                    onClick={() => setAmount(String(v))}
                    disabled={!isConnected}
                    className={`h-6 px-2.5 text-[11px] font-medium rounded-full transition-colors disabled:opacity-40 ${
                      amount === String(v)
                        ? "bg-sp/15 text-sp"
                        : "text-muted-foreground/55 hover:text-foreground hover:bg-white/5"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            )}
          </div>

          {mode === "wrap" ? (
            <>
              <div className="mt-3 flex items-baseline gap-2">
                <input
                  value={amount}
                  onChange={(e) =>
                    setAmount(e.target.value.replace(/[^0-9.]/g, ""))
                  }
                  inputMode="decimal"
                  placeholder="0"
                  className="w-full bg-transparent text-[24px] font-semibold tabular-nums leading-none focus:outline-none placeholder:text-muted-foreground/25"
                />
                <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground/55">
                  <UsdcIcon size={14} />
                  USDC
                </span>
              </div>
              {tooMuchUsdc && (
                <p className="mt-2 text-[11.5px] text-destructive/85">
                  Exceeds your USDC balance.
                </p>
              )}
            </>
          ) : (
            <div className="mt-3 text-[12.5px] text-muted-foreground/60 leading-relaxed">
              {!isConnected
                ? "Connect your wallet to unwrap."
                : !hasSealed
                  ? "No sealed balance to unwrap — wrap USDC first."
                  : "Unwraps your full sealed cUSDC balance. One signature to read the balance, one tx to request, one to claim."}
            </div>
          )}

          <ActionButton
            mode={mode}
            busy={mode === "wrap" ? wrapping : unwrapping}
            justDone={mode === "wrap" ? justWrapped : justUnwrapped}
            disabled={!canSubmit}
            onClick={mode === "wrap" ? handleWrap : handleUnwrap}
            isConnected={isConnected}
          />
        </div>
      </motion.section>
    </>
  );
}

function RefreshButton({
  busy,
  onClick,
}: {
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      aria-label="Refresh balance"
      title="Refresh balance"
      className="size-7 inline-flex items-center justify-center rounded-full text-muted-foreground/50 hover:text-foreground hover:bg-white/5 transition-colors disabled:opacity-60"
    >
      <RefreshCw
        className={`size-3.5 ${busy ? "animate-spin" : ""}`}
        strokeWidth={2}
      />
    </button>
  );
}

function RevealedBalance({
  isConnected,
  hasSealed,
  revealed,
  revealing,
  onReveal,
  onHide,
}: {
  isConnected: boolean;
  hasSealed: boolean;
  revealed: bigint | null;
  revealing: boolean;
  onReveal: () => void;
  onHide: () => void;
}) {
  if (!isConnected) {
    return (
      <span className="text-[22px] font-semibold text-muted-foreground/40 tabular-nums leading-none">
        —
      </span>
    );
  }
  if (!hasSealed) {
    return (
      <span className="text-[22px] font-semibold text-muted-foreground/40 tabular-nums leading-none">
        0.00
      </span>
    );
  }
  const revealedNow = revealed !== null;
  return (
    <div className="inline-flex items-center gap-2">
      <span
        className={`text-[22px] font-semibold tabular-nums leading-none ${
          revealedNow
            ? "text-sp/90"
            : "text-muted-foreground/80 tracking-[0.18em]"
        }`}
      >
        {revealedNow ? formatUsdc(revealed, 2) : "****"}
      </span>
      <button
        onClick={revealedNow ? onHide : onReveal}
        disabled={revealing}
        aria-label={revealedNow ? "Hide balance" : "Reveal balance"}
        title={revealedNow ? "Hide" : "Reveal"}
        className="size-7 inline-flex items-center justify-center rounded-full text-muted-foreground/60 hover:text-foreground hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-progress"
      >
        {revealing ? (
          <Spinner size={12} className="text-sp" />
        ) : revealedNow ? (
          <EyeOff className="size-3.5" strokeWidth={2} />
        ) : (
          <Eye className="size-3.5" strokeWidth={2} />
        )}
      </button>
    </div>
  );
}

function MintButton({
  onClick,
  busy,
  justMinted,
  disabled,
}: {
  onClick: () => void;
  busy: boolean;
  justMinted: boolean;
  disabled: boolean;
}) {
  return (
    <motion.button
      onClick={onClick}
      disabled={busy || disabled}
      whileTap={busy || disabled ? {} : { scale: 0.97 }}
      transition={{ duration: 0.12 }}
      className="h-8 px-3.5 text-[12px] font-medium border border-white/10 hover:border-white/25 text-muted-foreground/80 hover:text-foreground rounded-full inline-flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <AnimatePresence mode="wait" initial={false}>
        {justMinted ? (
          <motion.span
            key="ok"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            className="inline-flex items-center gap-1.5"
          >
            <Check className="size-3" strokeWidth={2.5} />
            Minted
          </motion.span>
        ) : busy ? (
          <motion.span
            key="busy"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="inline-flex items-center gap-1.5"
          >
            <Spinner size={12} className="text-sp" />
            Minting
          </motion.span>
        ) : (
          <motion.span
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="inline-flex items-center gap-1.5"
          >
            <Droplet className="size-3" strokeWidth={2} />
            Mint 1k
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

function ModeToggle({
  mode,
  onChange,
  disabled,
}: {
  mode: "wrap" | "unwrap";
  onChange: (m: "wrap" | "unwrap") => void;
  disabled: boolean;
}) {
  return (
    <div className="inline-flex items-center p-0.5 rounded-full bg-white/4 border border-white/6">
      {(["wrap", "unwrap"] as const).map((m) => {
        const active = mode === m;
        return (
          <button
            key={m}
            onClick={() => onChange(m)}
            disabled={disabled}
            className={`relative h-6 px-3 text-[11px] font-medium uppercase tracking-[0.06em] rounded-full transition-colors disabled:opacity-40 ${
              active
                ? "text-[#050505]"
                : "text-muted-foreground/60 hover:text-foreground"
            }`}
          >
            {active && (
              <motion.span
                layoutId="mode-toggle"
                className="absolute inset-0 bg-sp rounded-full"
                transition={{ type: "spring", duration: 0.35, bounce: 0.18 }}
              />
            )}
            <span className="relative">{m}</span>
          </button>
        );
      })}
    </div>
  );
}

function ActionButton({
  mode,
  busy,
  justDone,
  disabled,
  isConnected,
  onClick,
}: {
  mode: "wrap" | "unwrap";
  busy: boolean;
  justDone: boolean;
  disabled: boolean;
  isConnected: boolean;
  onClick: () => void;
}) {
  const busyLabel = mode === "wrap" ? "Wrapping" : "Requesting";
  const doneLabel = mode === "wrap" ? "Wrapped" : "Unwrapped";
  const idleLabel = mode === "wrap" ? "Wrap" : "Unwrap all";
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      whileTap={disabled ? {} : { scale: 0.98 }}
      transition={{ duration: 0.12 }}
      className="mt-4 w-full h-10 px-4 text-[13px] font-medium bg-sp text-[#050505] hover:bg-sp/90 rounded-full inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <AnimatePresence mode="wait" initial={false}>
        {busy ? (
          <motion.span
            key="busy"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="inline-flex items-center gap-2"
          >
            <Spinner size={12} className="text-[#050505]" />
            {busyLabel}
          </motion.span>
        ) : justDone ? (
          <motion.span
            key="done"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            className="inline-flex items-center gap-2"
          >
            <Check className="size-3.5" strokeWidth={2.5} />
            {doneLabel}
          </motion.span>
        ) : (
          <motion.span
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="inline-flex items-center gap-2"
          >
            <Lock className="size-3.5" strokeWidth={2.2} />
            {isConnected ? idleLabel : "Connect wallet"}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}
