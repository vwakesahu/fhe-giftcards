"use client";

import { motion } from "motion/react";
import { Check } from "lucide-react";

import { PRODUCTS, type Product } from "@/lib/contracts";
import { EASE_OUT } from "@/lib/motion";

export function ProductStep({
  selectedId,
  onSelect,
}: {
  selectedId: number | null;
  onSelect: (p: Product) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { staggerChildren: 0.04 } }}
      className="rounded-2xl border border-white/[0.06] overflow-hidden"
    >
      {PRODUCTS.map((p, i) => (
        <ProductRow
          key={p.id}
          product={p}
          active={selectedId === p.id}
          first={i === 0}
          onClick={p.comingSoon ? undefined : () => onSelect(p)}
        />
      ))}
    </motion.div>
  );
}

function ProductRow({
  product,
  active,
  first,
  onClick,
}: {
  product: Product;
  active: boolean;
  first: boolean;
  onClick: (() => void) | undefined;
}) {
  const disabled = product.comingSoon;
  return (
    <motion.button
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: EASE_OUT }}
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled}
      className={`group relative grid grid-cols-[28px_minmax(0,1fr)_auto_28px] items-center gap-3 w-full h-12 px-4 text-left transition-colors ${
        first ? "" : "border-t border-white/[0.04]"
      } ${
        disabled
          ? "cursor-not-allowed opacity-45"
          : `hover:bg-white/[0.03] ${active ? "bg-white/[0.03]" : ""}`
      }`}
    >
      {active && !disabled && (
        <motion.span
          layoutId="product-indicator"
          className="absolute left-0 top-2 bottom-2 w-[2px] bg-sp rounded-r-full"
          transition={{ type: "spring", duration: 0.4, bounce: 0.18 }}
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={product.icon}
        alt=""
        width={18}
        height={18}
        className={`size-[18px] ${disabled ? "grayscale" : ""}`}
      />
      <p className="text-[13px] font-medium truncate">
        {product.label}{" "}
        <span className="text-muted-foreground/55">· ${product.face}</span>
      </p>
      {disabled ? (
        <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground/55">
          Coming soon
        </span>
      ) : (
        <span className="text-[13px] font-semibold tabular-nums">
          {product.priceUsdc}
          <span className="ml-1 text-[11px] text-muted-foreground/50 font-normal">
            USDC
          </span>
        </span>
      )}
      <span
        className={`size-5 rounded-full flex items-center justify-center transition-all ${
          disabled
            ? "border border-white/[0.05] text-transparent"
            : active
              ? "bg-sp text-[#0d0c0a]"
              : "border border-white/[0.08] text-transparent group-hover:border-white/20"
        }`}
      >
        <Check className="size-3" strokeWidth={3} />
      </span>
    </motion.button>
  );
}
