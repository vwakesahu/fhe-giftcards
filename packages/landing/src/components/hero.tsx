"use client";

import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
  AnimatePresence,
} from "framer-motion";
import { Check, Inbox, Lock, ShoppingBag, Wallet } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  APP_URL,
  BRAND_NAME,
  CTA_OPEN_APP,
  DEMO_PAID_CUSDC,
  PRODUCTS,
  RELAY_ADDR,
  SELECTED_PRODUCT_ID,
} from "@/lib/constants";
import { SigillWordmark } from "./icons";

const ease = [0.165, 0.84, 0.44, 1] as const;

export function Hero() {
  return (
    <section className="relative pt-32 sm:pt-44 pb-24 sm:pb-32 overflow-clip">
      <Backdrop />

      <div className="relative z-10 max-w-7xl mx-auto px-6 sm:px-10">
        <Preamble />
        <Hairline />
        <StageMock />
      </div>
    </section>
  );
}

/* Preamble: the words sit in a deliberately narrow column at the
   top-left. They are the caption to the product, not its equal. */
function Preamble() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-y-10 lg:gap-x-10">
      <h1 className="lg:col-span-8 text-[clamp(3rem,7.5vw,6.5rem)] font-medium leading-[0.96] tracking-[-0.04em]">
        <span className="block overflow-hidden">
          <motion.span
            className="block"
            initial={{ y: "105%" }}
            animate={{ y: 0 }}
            transition={{ duration: 0.95, delay: 0.1, ease }}
          >
            Buy a gift card.
          </motion.span>
        </span>
        <span className="block overflow-hidden">
          <motion.span
            className="block text-foreground/55"
            initial={{ y: "105%" }}
            animate={{ y: 0 }}
            transition={{ duration: 0.95, delay: 0.18, ease }}
          >
            Privately.
          </motion.span>
        </span>
      </h1>

      <div className="lg:col-span-4 lg:pt-3">
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.45, ease }}
          className="text-[16px] leading-[1.55] text-foreground/65 max-w-[34ch]"
        >
          The chain never sees what you paid. The observer never sees
          the code. Only your wallet can open the envelope.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.58, ease }}
          className="mt-7 flex items-center gap-2"
        >
          <a
            href={APP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-foreground text-background pl-5 pr-4 py-3 text-[14px] font-medium hover:opacity-90 transition-opacity"
          >
            {CTA_OPEN_APP}
            <span aria-hidden>→</span>
          </a>
          <a
            href="#how"
            className="text-[14px] font-medium text-foreground/65 hover:text-foreground transition-colors px-3 py-2"
          >
            See it work
          </a>
        </motion.div>
      </div>
    </div>
  );
}

/* Hairline that draws across, separating preamble from product.
   Stage-direction punctuation. A hand-set move, not template chrome. */
function Hairline() {
  return (
    <div className="mt-20 sm:mt-28 mb-12 sm:mb-16 flex items-center gap-5">
      <motion.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 1.1, delay: 0.8, ease }}
        style={{ transformOrigin: "0% 50%" }}
        className="flex-1 h-px bg-foreground/10"
      />
      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 1.4, ease }}
        className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-foreground/35"
      >
        the app, mid-flow
      </motion.span>
    </div>
  );
}

/* The product mock anchors its own row, larger than the text above.
   A composed centerpiece, not a sibling column. */
function StageMock() {
  return (
    <div className="relative">
      <AppMock />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   A high-fidelity mock of the actual Sigill checkout. Same fonts,
   same hairlines, same uppercase mono labels, same sage-green
   "sealed" values, same lock-icon CTA as the real app.
   Builds in a small sequence on mount so the page feels alive,
   then settles into the "Sealed envelope" confirm state.
   ────────────────────────────────────────────────────────────── */

// Product list + selected id come from @/lib/constants so the same demo
// data drives the bezier diagram and any future shareable card mock.

function AppMock() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement | null>(null);

  // Gentle scroll parallax. The panel rises slightly out of frame.
  const { scrollY } = useScroll();
  const yParallax = useTransform(scrollY, [0, 700], [0, -50]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 1.1, delay: 0.3, ease }}
      style={{ y: reduce ? 0 : yParallax }}
      className="relative w-full"
      ref={ref}
    >
      <Panel />
    </motion.div>
  );
}

function Panel() {
  // Framed as a real macOS browser window, not a one-off marketing card.
  // Traffic lights, URL bar, a peek of the app's sidebar. The things a
  // real screenshot would have and AI mockups never do.
  return (
    <div
      className="relative rounded-xl overflow-hidden border border-white/[0.06] bg-[#0a0908]"
      style={{
        boxShadow:
          "0 50px 80px -30px rgba(0,0,0,0.85), 0 12px 30px -12px rgba(0,0,0,0.5)",
      }}
    >
      <BrowserChrome />
      {/* Mobile: sidebar hidden, AppBody takes full width.
          Desktop: sidebar + body in a 180/1fr split. */}
      <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] min-h-[380px] sm:min-h-[420px]">
        <div className="hidden sm:block">
          <Sidebar />
        </div>
        <AppBody />
      </div>
    </div>
  );
}

function BrowserChrome() {
  // Real macOS window chrome. Traffic lights left, URL pill centered.
  return (
    <div className="relative flex items-center h-9 px-3.5 bg-[#181614] border-b border-white/[0.05]">
      <div className="flex items-center gap-[6px]">
        <span className="block w-[11px] h-[11px] rounded-full bg-[#ff5f57]" />
        <span className="block w-[11px] h-[11px] rounded-full bg-[#febc2e]" />
        <span className="block w-[11px] h-[11px] rounded-full bg-[#28c840]" />
      </div>
      <div className="absolute left-1/2 -translate-x-1/2 inline-flex items-center gap-2 h-5 px-2.5 rounded-md bg-black/40 text-foreground/55">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-2.5 opacity-70"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
        <span className="font-mono text-[10.5px] tracking-tight">
          app.sigill.store/buy
        </span>
      </div>
    </div>
  );
}

function Sidebar() {
  // Mirrors the real app's nav (Inbox / ShoppingBag / Wallet) so this
  // reads as a screenshot, not a mockup. Real lucide icons, not ASCII.
  const items = [
    { label: "Orders", Icon: Inbox, active: false },
    { label: "Buy", Icon: ShoppingBag, active: true },
    { label: "Balances", Icon: Wallet, active: false },
  ];
  return (
    <aside className="border-r border-white/[0.04] p-3 sm:p-4 flex flex-col gap-0.5 bg-white/[0.005]">
      <div className="hidden sm:flex items-baseline mb-5 px-2 sm:px-2.5 h-7">
        <SigillWordmark
          className="text-[18px] text-foreground/90"
          withBeta
        />
      </div>
      {items.map(({ label, Icon, active }) => (
        <div
          key={label}
          className={`flex items-center gap-2.5 h-8 px-2 sm:px-2.5 rounded-md ${
            active
              ? "bg-white/[0.05] text-foreground/95"
              : "text-foreground/55"
          }`}
        >
          <Icon
            className={`size-3.5 shrink-0 ${
              active ? "text-foreground/95" : "text-foreground/65"
            }`}
            strokeWidth={1.75}
          />
          <span className="hidden sm:inline text-[12.5px] font-medium">
            {label}
          </span>
        </div>
      ))}
    </aside>
  );
}

function AppBody() {
  // Centered, capped content column. The way the real app composes
  // a focused flow page. Without this cap, the rows stretch corner to
  // corner and read as marketing chrome rather than a real screen.
  return (
    <div className="px-5 sm:px-8 py-5 sm:py-8">
      <div className="mx-auto w-full max-w-[420px] flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <h3 className="text-[14px] font-medium text-foreground/90 tracking-tight">
            Buy a gift card
          </h3>
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-foreground/35">
            Step 3 of 3
          </span>
        </div>
        <ProductList />
        <SealedEnvelope />
        <PlaceButton />
      </div>
    </div>
  );
}

function ProductList() {
  // Starts on #01, then animates to #02 once mounted. Mimics the real
  // buy-wizard feel. Initial value is the starting state (not the final
  // one) so the effect only schedules the transition, never resets.
  const [activeId, setActiveId] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => setActiveId(SELECTED_PRODUCT_ID), 1100);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="rounded-xl border border-white/[0.05] overflow-hidden">
      {PRODUCTS.map((p, i) => (
        <ProductRow
          key={p.id}
          product={p}
          active={activeId === p.id}
          first={i === 0}
          delay={0.5 + i * 0.08}
        />
      ))}
    </div>
  );
}

function ProductRow({
  product,
  active,
  first,
  delay,
}: {
  product: (typeof PRODUCTS)[number];
  active: boolean;
  first: boolean;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay, ease }}
      className={`relative grid grid-cols-[40px_minmax(0,1fr)_auto_24px] items-center gap-3 h-11 px-4 ${
        first ? "" : "border-t border-white/[0.04]"
      } ${active ? "bg-white/[0.025]" : ""}`}
    >
      <AnimatePresence>
        {active && (
          <motion.span
            key="bar"
            layoutId="row-indicator"
            className="absolute left-0 top-[6px] bottom-[6px] w-[2px] bg-[#7dd4a4] rounded-r-full"
            transition={{ type: "spring", duration: 0.5, bounce: 0.22 }}
          />
        )}
      </AnimatePresence>

      <span className="font-mono text-[10.5px] text-foreground/35 tabular-nums">
        #{String(product.id).padStart(2, "0")}
      </span>
      <p className="text-[12.5px] font-medium truncate text-foreground/90">
        {product.label}{" "}
        <span className="text-foreground/45">· ${product.face}</span>
      </p>
      <span className="text-[12.5px] font-semibold tabular-nums text-foreground/90">
        {product.priceUsdc}
        <span className="ml-1 text-[10.5px] text-foreground/40 font-normal">
          USDC
        </span>
      </span>
      <span
        className={`size-5 rounded-full flex items-center justify-center transition-all ${
          active
            ? "bg-[#7dd4a4] text-[#0a0a0a]"
            : "border border-white/[0.1] text-transparent"
        }`}
      >
        <Check className="size-3" strokeWidth={3} />
      </span>
    </motion.div>
  );
}

function SealedEnvelope() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 1.3, ease }}
      className="rounded-xl border border-white/[0.06]"
    >
      <div className="px-4 h-8 flex items-center border-b border-white/[0.04]">
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-foreground/40">
          Sealed envelope
        </p>
      </div>
      <div className="divide-y divide-white/[0.04]">
        <Row label="Product" value="Amazon US · $10" />
        <Row label="You pay" value={DEMO_PAID_CUSDC} sealed />
        <Row label="Relay" value={RELAY_ADDR} mono />
      </div>
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
    <div className="px-4 h-10 flex items-center justify-between gap-6">
      <p className="font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-foreground/40">
        {label}
      </p>
      <p
        className={`tabular-nums ${
          mono ? "font-mono text-[11px]" : "text-[12.5px]"
        } ${sealed ? "text-[#7dd4a4] font-medium" : "text-foreground/85"}`}
      >
        {value}
      </p>
    </div>
  );
}


function PlaceButton() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 1.5, ease }}
      className="flex items-center justify-end"
    >
      <div className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-[#7dd4a4] text-[#0a0a0a] text-[12.5px] font-medium">
        <Lock className="size-3.5" strokeWidth={2.5} />
        Seal &amp; place order
      </div>
    </motion.div>
  );
}

function Backdrop() {
  return (
    <div
      aria-hidden
      className="absolute -top-32 left-1/2 -translate-x-1/2 w-[1100px] h-[600px] pointer-events-none"
      style={{
        background:
          "radial-gradient(ellipse at center, rgba(125,212,164,0.05), transparent 60%)",
        filter: "blur(60px)",
      }}
    />
  );
}
