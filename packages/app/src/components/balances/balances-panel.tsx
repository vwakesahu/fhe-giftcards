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
import { ArrowDown, Check, Droplet, Eye, EyeOff, Lock } from "lucide-react";

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

  const [amount, setAmount] = useState<string>("50");
  const [wrapping, setWrapping] = useState(false);
  const [justWrapped, setJustWrapped] = useState(false);

  const [minting, setMinting] = useState(false);
  const [justMinted, setJustMinted] = useState(false);

  const [revealing, setRevealing] = useState(false);
  const [revealed, setRevealed] = useState<Revealed | null>(null);

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
    query: { enabled: !!address },
  });

  const amountNum = Number(amount);
  const amountRaw =
    Number.isFinite(amountNum) && amountNum > 0
      ? BigInt(Math.floor(amountNum * 1_000_000))
      : 0n;
  const handle = (cUSDCHandle as bigint | undefined) ?? 0n;
  const hasSealed = handle > 0n;
  const tooMuch = amountRaw > (usdcBalance ?? 0n);
  const canWrap = isConnected && amountRaw > 0n && !tooMuch && !wrapping;

  // Drop stale reveal if the handle rotated (e.g. after a wrap)
  const currentReveal = revealed && revealed.handle === handle ? revealed : null;

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
      if (receipt.status !== "success") throw new Error("Mint reverted on-chain");
      toast.success("Minted 1,000 USDC");
      refetchUsdc();
      setJustMinted(true);
      setTimeout(() => setJustMinted(false), 2400);
    } catch (err) {
      toast.error(err instanceof Error ? err.message.slice(0, 100) : "Mint failed");
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
      if (value === null) throw new Error("Decryption still pending — try again in a bit");
      setRevealed({ handle, value });
    } catch (err) {
      toast.error(err instanceof Error ? err.message.slice(0, 120) : "Reveal failed");
    } finally {
      setRevealing(false);
    }
  }

  async function handleWrap() {
    if (!address || !publicClient || !walletClient || !canWrap) return;
    try {
      setWrapping(true);
      toast.message("Approving USDC");
      const approveHash = await walletClient.writeContract({
        address: addresses.USDC,
        abi: usdcAbi,
        functionName: "approve",
        args: [addresses.cUSDC, amountRaw],
        account: walletClient.account!,
        chain: walletClient.chain,
      });
      const approveReceipt = await publicClient.waitForTransactionReceipt({
        hash: approveHash,
      });
      if (approveReceipt.status !== "success") {
        throw new Error("USDC approval reverted — try again");
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
      toast.error(err instanceof Error ? err.message.slice(0, 120) : "Wrap failed");
    } finally {
      setWrapping(false);
    }
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: EASE_OUT }}
      >
        <h1 className="text-[20px] font-semibold tracking-[-0.01em]">Balances</h1>
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
          <RevealedBalance
            isConnected={isConnected}
            hasSealed={hasSealed}
            revealed={currentReveal?.value ?? null}
            revealing={revealing}
            onReveal={handleReveal}
            onHide={() => setRevealed(null)}
          />
        </div>

        {/* Wrap form */}
        <div className="mt-4 pt-4 border-t border-white/4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/50">
              Wrap amount
            </p>
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
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              inputMode="decimal"
              placeholder="0"
              className="w-full bg-transparent text-[24px] font-semibold tabular-nums leading-none focus:outline-none placeholder:text-muted-foreground/25"
            />
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground/55">
              <UsdcIcon size={14} />
              USDC
            </span>
          </div>
          {tooMuch && (
            <p className="mt-2 text-[11.5px] text-destructive/85">
              Exceeds your USDC balance.
            </p>
          )}
          <WrapButton
            wrapping={wrapping}
            justWrapped={justWrapped}
            disabled={!canWrap}
            onClick={handleWrap}
            isConnected={isConnected}
          />
        </div>
      </motion.section>
    </>
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
          revealedNow ? "text-sp/90" : "text-muted-foreground/80 tracking-[0.18em]"
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

function WrapButton({
  wrapping,
  justWrapped,
  disabled,
  isConnected,
  onClick,
}: {
  wrapping: boolean;
  justWrapped: boolean;
  disabled: boolean;
  isConnected: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      whileTap={disabled ? {} : { scale: 0.98 }}
      transition={{ duration: 0.12 }}
      className="mt-4 w-full h-10 px-4 text-[13px] font-medium bg-sp text-[#050505] hover:bg-sp/90 rounded-full inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <AnimatePresence mode="wait" initial={false}>
        {wrapping ? (
          <motion.span
            key="busy"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="inline-flex items-center gap-2"
          >
            <Spinner size={12} className="text-[#050505]" />
            Wrapping
          </motion.span>
        ) : justWrapped ? (
          <motion.span
            key="done"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            className="inline-flex items-center gap-2"
          >
            <Check className="size-3.5" strokeWidth={2.5} />
            Wrapped
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
            {isConnected ? "Wrap" : "Connect wallet"}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}
