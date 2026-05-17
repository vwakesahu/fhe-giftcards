"use client";

import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { Lock, ArrowRight } from "lucide-react";

import type { Product, ObserverEntry } from "@/lib/contracts";
import { EASE_OUT } from "@/lib/motion";
import { shortAddr } from "@/lib/format";
import { Spinner } from "@/components/spinner";

// 6-decimal cUSDC base units → human string. `freeAsLabel` renders 0 as
// "Free" rather than "0 USDC" — used for the relay fee row.
function formatUsdc(
  value: bigint,
  opts: { freeAsLabel?: boolean } = {},
): string {
  if (value === 0n) return opts.freeAsLabel ? "Free" : "0 USDC";
  const whole = value / 1_000_000n;
  const frac = value % 1_000_000n;
  if (frac === 0n) return `${whole} USDC`;
  const fracStr = frac
    .toString()
    .padStart(6, "0")
    .slice(0, 3)
    .replace(/0+$/, "");
  return `${whole}.${fracStr || "0"} USDC`;
}

export function ConfirmStep({
  product,
  observer,
  placing,
  hasSealedBalance,
  onPlace,
}: {
  product: Product;
  observer: ObserverEntry;
  placing: boolean;
  hasSealedBalance: boolean;
  onPlace: () => void;
}) {
  const completedLabel =
    observer.ordersCompleted > 0n
      ? `${observer.ordersCompleted} order${observer.ordersCompleted === 1n ? "" : "s"} fulfilled`
      : "no track record yet";
  // All three components are plaintext at this step. The on-chain contract
  // re-encrypts them for the quote total via FHE, but the user-facing math
  // is the same: total = card price + relay fee + 0.25% of card price.
  const priceBase = BigInt(product.priceUsdc) * 1_000_000n;
  const platformFeeBase = (priceBase * 25n) / 10_000n;
  const feeIsHandle =
    observer.feeUsdc > 1_000_000n * 1_000_000n; // sanity ceiling — see step-observer
  const observerFeeBase = feeIsHandle ? 0n : observer.feeUsdc;
  const totalBase = priceBase + observerFeeBase + platformFeeBase;
  const feeLabel = formatUsdc(observer.feeUsdc, { freeAsLabel: true });
  const platformFeeLabel = `${formatUsdc(platformFeeBase)} · 0.25%`;
  const totalLabel = formatUsdc(totalBase);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, ease: EASE_OUT }}
      className="flex flex-col gap-3"
    >
      {/* Envelope */}
      <div className="rounded-2xl border border-white/6">
        <div className="px-5 h-9 flex items-center border-b border-white/4">
          <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground/50">
            Sealed envelope
          </p>
        </div>
        <div className="divide-y divide-white/4">
          <Row label="Product" value={`${product.label} · $${product.face}`} sealed />
          <Row label="Card price" value={`${product.priceUsdc}.00 cUSDC`} />
          <Row label="Relay fee" value={feeLabel} />
          <Row label="Platform fee" value={platformFeeLabel} />
          <Row label="Total to pay" value={totalLabel} sealed />
          <Row label="Observer track record" value={completedLabel} />
          <Row label="Relay" value={shortAddr(observer.address, 6, 4)} mono />
        </div>
        <div className="px-5 py-3 border-t border-white/4">
          <p className="text-[11.5px] text-muted-foreground/55 leading-relaxed">
            Three transactions: <span className="text-foreground/75">quoteOrder</span> for an encrypted total,
            approve sealed cUSDC, then <span className="text-foreground/75">confirmOrder</span>.
            The observer unseals, fulfils, and drops a code only your wallet can open.
          </p>
        </div>
      </div>

      {!hasSealedBalance && (
        <Link
          href="/wrap"
          className="h-9 px-4 inline-flex items-center justify-between text-[12px] font-medium text-sp border border-sp/30 hover:bg-sp/10 rounded-full transition-colors"
        >
          <span>No sealed balance — wrap USDC first</span>
          <ArrowRight className="size-3" />
        </Link>
      )}

      <PlaceButton
        placing={placing}
        disabled={!hasSealedBalance}
        onClick={onPlace}
      />
    </motion.div>
  );
}

function Row({
  label,
  value,
  sealed,
  mono,
}: {
  label: string;
  value: string;
  sealed?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="px-5 h-11 flex items-center justify-between gap-6">
      <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground/50">
        {label}
      </p>
      <p
        className={`tabular-nums ${mono ? "font-mono text-[12px]" : "text-[13px]"} ${
          sealed ? "text-sp font-medium" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function PlaceButton({
  placing,
  disabled,
  onClick,
}: {
  placing: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const off = placing || disabled;
  return (
    <motion.button
      onClick={onClick}
      disabled={off}
      whileTap={off ? {} : { scale: 0.98 }}
      transition={{ duration: 0.12 }}
      className={`h-10 px-4 text-[13px] font-medium bg-sp text-[#0d0c0a] hover:bg-sp/90 transition-colors rounded-full inline-flex items-center justify-center gap-2 ${
        placing ? "opacity-80 cursor-progress" : disabled ? "opacity-40 cursor-not-allowed" : ""
      }`}
    >
      <AnimatePresence mode="wait" initial={false}>
        {placing ? (
          <motion.span
            key="p"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="inline-flex items-center gap-2"
          >
            <Spinner size={12} className="text-[#0d0c0a]" />
            Sealing
          </motion.span>
        ) : (
          <motion.span
            key="i"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="inline-flex items-center gap-2"
          >
            <Lock className="size-3.5" strokeWidth={2.5} />
            Seal &amp; place order
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}
