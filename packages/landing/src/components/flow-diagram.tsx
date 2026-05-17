"use client";

import { motion, useInView } from "framer-motion";
import Image from "next/image";
import { useRef } from "react";

import { SigillWordmark } from "./icons";

const ease = [0.165, 0.84, 0.44, 1] as const;

/* ──────────────────────────────────────────────────────────────
   Plaintext inputs converge into the Sigill seal, then diverge as
   ciphertext outputs. Two layouts:

     md+ : the horizontal SVG (Tachyon-style converge → seal → diverge)
     <md : a stacked vertical layout sized for portrait screens, with
           a shorter portrait SVG. Same metaphor, no microscopic text.

   The seal box itself carries two labels — "Sigill" on top, a hairline
   rule, then "Fhenix CoFHE" beneath. Makes Fhenix's role explicit:
   it is the encryption engine Sigill is built on.
   ────────────────────────────────────────────────────────────── */

const INPUTS = [
  { label: "USDC", caption: "Plaintext token" },
  { label: "Product choice", caption: "Amazon · $5 / $10 / $25" },
  { label: "Buyer wallet", caption: "Your signer + decrypt key" },
] as const;

const OUTPUTS = [
  { label: "Base Sepolia", caption: "Opaque handles only" },
  { label: "Observer", caption: "Decrypts product ID + paid amount" },
  { label: "IPFS", caption: "AES ciphertext, gibberish on its own" },
  { label: "Your wallet", caption: "Unseals the AES key, reads the code" },
] as const;

export function FlowDiagram() {
  const ref = useRef<HTMLDivElement | null>(null);
  const inView = useInView(ref, { once: true, margin: "-15%" });

  return (
    <section className="py-28 sm:py-36 px-6 sm:px-10">
      <div ref={ref} className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, ease }}
          className="mb-12 sm:mb-16 max-w-2xl"
        >
          <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-foreground/35 mb-5">
            What goes where
          </p>
          <h2 className="text-[clamp(2rem,4vw,3.25rem)] font-medium leading-[1.04] tracking-[-0.03em]">
            Plaintext goes in.
            <br />
            <span className="text-foreground/55">Ciphertext goes out.</span>
          </h2>
          <p className="mt-6 max-w-md text-[15px] leading-[1.6] text-foreground/60">
            Three inputs meet the seal. Four destinations get only what
            they need. The encryption itself runs on Fhenix CoFHE, the
            engine inside the seal.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 1, delay: 0.15, ease }}
          className="relative"
        >
          {/* Desktop: horizontal converge → seal → diverge. */}
          <div className="hidden md:block">
            <DesktopDiagram inView={inView} />
          </div>
          {/* Mobile: vertical converge → seal → diverge. */}
          <div className="md:hidden">
            <MobileDiagram inView={inView} />
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────
   Desktop diagram. viewBox 1200x540 — 3 inputs left, seal center,
   4 outputs right. Cubic-bezier paths converge to (HUB_LEFT, HUB_Y)
   and diverge from (HUB_RIGHT, HUB_Y).
   ────────────────────────────────────────────────────────────── */

// y-positions for the boxes. Inputs (3): centered around HUB_Y with
// generous gaps. Outputs (4): tighter so the diverge fan fits.
const D_INPUTS = INPUTS.map((it, i) => ({ ...it, y: 120 + i * 160 }));
const D_OUTPUTS = OUTPUTS.map((it, i) => ({ ...it, y: 60 + i * 130 }));

const VB = { w: 1200, h: 600 };
const INPUT_X = 280;
const HUB_LEFT = 460;
const HUB_RIGHT = 740;
const OUTPUT_X = 920;
const HUB_Y = 280;
const BOX_W = 280;
const BOX_H = 78; // taller, label + caption stacked instead of overlapping

function DesktopDiagram({ inView }: { inView: boolean }) {
  return (
    <svg
      viewBox={`0 0 ${VB.w} ${VB.h}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      className="w-full h-auto"
      role="img"
      aria-label="Plaintext inputs converge through the Sigill seal, powered by Fhenix CoFHE, and emerge as ciphertext destinations."
    >
      <defs>
        <linearGradient id="line-in" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.55" />
        </linearGradient>
        <linearGradient id="line-out" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.55" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.18" />
        </linearGradient>
      </defs>

      <g className="text-foreground">
        {/* Converge beziers */}
        {D_INPUTS.map((input, i) => (
          <BezierPath
            key={`in-${i}`}
            d={`M ${INPUT_X} ${input.y + 39} C 380 ${input.y + 39}, 400 ${HUB_Y}, ${HUB_LEFT} ${HUB_Y}`}
            grad="url(#line-in)"
            delay={0.25 + i * 0.08}
            inView={inView}
          />
        ))}
        {/* Diverge beziers */}
        {D_OUTPUTS.map((out, i) => (
          <BezierPath
            key={`out-${i}`}
            d={`M ${HUB_RIGHT} ${HUB_Y} C 820 ${HUB_Y}, 840 ${out.y + 39}, ${OUTPUT_X} ${out.y + 39}`}
            grad="url(#line-out)"
            delay={0.55 + i * 0.08}
            inView={inView}
          />
        ))}

        <circle cx={HUB_LEFT} cy={HUB_Y} r="3" fill="currentColor" opacity="0.45" />
        <circle cx={HUB_RIGHT} cy={HUB_Y} r="3" fill="currentColor" opacity="0.45" />

        <SealBox />

        {D_INPUTS.map((input, i) => (
          <SideBox
            key={`ibox-${i}`}
            x={0}
            y={input.y}
            label={input.label}
            caption={input.caption}
            kind="in"
            delay={0.1 + i * 0.08}
            inView={inView}
          />
        ))}
        {D_OUTPUTS.map((out, i) => (
          <SideBox
            key={`obox-${i}`}
            x={OUTPUT_X}
            y={out.y}
            label={out.label}
            caption={out.caption}
            kind="out"
            delay={0.75 + i * 0.07}
            inView={inView}
          />
        ))}
      </g>
    </svg>
  );
}

function BezierPath({
  d,
  grad,
  delay,
  inView,
}: {
  d: string;
  grad: string;
  delay: number;
  inView: boolean;
}) {
  return (
    <motion.path
      d={d}
      stroke={grad}
      strokeWidth="1"
      fill="none"
      initial={{ pathLength: 0, opacity: 0 }}
      animate={inView ? { pathLength: 1, opacity: 1 } : {}}
      transition={{ duration: 0.9, delay, ease }}
    />
  );
}

function SideBox({
  x,
  y,
  label,
  caption,
  kind,
  delay,
  inView,
}: {
  x: number;
  y: number;
  label: string;
  caption: string;
  kind: "in" | "out";
  delay: number;
  inView: boolean;
}) {
  const slide = kind === "in" ? -8 : 8;
  const meta = kind === "in" ? "PLAINTEXT · IN" : "CIPHERTEXT · OUT";
  return (
    <motion.g
      initial={{ opacity: 0, x: slide }}
      animate={inView ? { opacity: 1, x: 0 } : {}}
      transition={{ duration: 0.6, delay, ease }}
    >
      <rect
        x={x}
        y={y}
        width={BOX_W}
        height={BOX_H}
        fill="rgba(255,255,255,0.012)"
        stroke="currentColor"
        strokeOpacity="0.1"
        rx="12"
      />
      {/* Meta · Label · Caption stacked. Captions can be long (e.g.
          "Unseals the AES key, reads the code") so they need their
          own line, not the right-side of the label row. */}
      <text
        x={x + 20}
        y={y + 22}
        fill="currentColor"
        fillOpacity="0.35"
        fontFamily="var(--font-geist-mono), monospace"
        fontSize="10"
        letterSpacing="2"
      >
        {meta}
      </text>
      <text
        x={x + 20}
        y={y + 44}
        fill="currentColor"
        fontFamily="var(--font-geist-sans), sans-serif"
        fontSize="15"
        fontWeight="500"
      >
        {label}
      </text>
      <text
        x={x + 20}
        y={y + 64}
        fill="currentColor"
        fillOpacity="0.45"
        fontFamily="var(--font-geist-sans), sans-serif"
        fontSize="11.5"
      >
        {caption}
      </text>
    </motion.g>
  );
}

/* Seal box with the Σ mark and a Fhenix-CoFHE engine sub-section. */
function SealBox() {
  const x = HUB_LEFT;
  const w = HUB_RIGHT - HUB_LEFT;
  const h = 220;
  const y = HUB_Y - h / 2;

  return (
    <motion.g
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.8, delay: 0.4, ease }}
      style={{ transformOrigin: "600px 280px" }}
    >
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill="rgba(255,255,255,0.02)"
        stroke="currentColor"
        strokeOpacity="0.22"
        strokeWidth="1.25"
        rx="16"
      />

      <text
        x={x + 20}
        y={y + 24}
        fill="currentColor"
        fillOpacity="0.4"
        fontFamily="var(--font-geist-mono), monospace"
        fontSize="10"
        letterSpacing="2"
      >
        THE SEAL
      </text>

      {/* Wordmark inside the seal: italic serif "sigill" centered, the
          same treatment as the app sidebar. Carries the brand without
          a separate iconic mark. */}
      <text
        x={x + w / 2}
        y={y + 96}
        textAnchor="middle"
        fill="currentColor"
        fontFamily="var(--font-serif), 'Times New Roman', serif"
        fontStyle="italic"
        fontSize="40"
        letterSpacing="-0.01em"
      >
        sigill
      </text>
      {/* Hairline that splits Sigill (app layer) from Fhenix CoFHE
          (encryption engine). Visually says: Sigill is built on top
          of Fhenix CoFHE. */}
      <line
        x1={x + 28}
        x2={x + w - 28}
        y1={y + h - 50}
        y2={y + h - 50}
        stroke="currentColor"
        strokeOpacity="0.12"
      />

      {/* ENCRYPTION ENGINE label sits ~20px above the Fhenix logo so
          the two read as a stacked group, not collided lines. */}
      <text
        x={x + w / 2}
        y={y + h - 44}
        textAnchor="middle"
        fill="currentColor"
        fillOpacity="0.4"
        fontFamily="var(--font-geist-mono), monospace"
        fontSize="9"
        letterSpacing="2"
      >
        ENCRYPTION ENGINE
      </text>
      <image
        href="/fhenix.svg"
        x={x + w / 2 - 48}
        y={y + h - 28}
        width="96"
        height="18"
        preserveAspectRatio="xMidYMid meet"
        opacity="0.85"
      />
    </motion.g>
  );
}

/* ──────────────────────────────────────────────────────────────
   Mobile diagram. Stacked vertically: inputs on top, seal in the
   middle, outputs at the bottom. Each segment is a small SVG with
   converging or diverging vertical beziers. Same metaphor as the
   desktop, sized for a 360-480px-wide column.
   ────────────────────────────────────────────────────────────── */

function MobileDiagram({ inView }: { inView: boolean }) {
  return (
    <div className="flex flex-col items-stretch gap-3 text-foreground">
      <MobileBoxGroup
        items={INPUTS}
        kind="in"
        startDelay={0.1}
        inView={inView}
      />

      <MobileConvergeStrip kind="converge" inView={inView} />

      <MobileSeal inView={inView} />

      <MobileConvergeStrip kind="diverge" inView={inView} />

      <MobileBoxGroup
        items={OUTPUTS}
        kind="out"
        startDelay={0.5}
        inView={inView}
      />
    </div>
  );
}

function MobileBoxGroup({
  items,
  kind,
  startDelay,
  inView,
}: {
  items: readonly { label: string; caption: string }[];
  kind: "in" | "out";
  startDelay: number;
  inView: boolean;
}) {
  const meta = kind === "in" ? "PLAINTEXT · IN" : "CIPHERTEXT · OUT";
  return (
    <div className="grid grid-cols-1 gap-2">
      {items.map((it, i) => (
        <motion.div
          key={it.label}
          initial={{ opacity: 0, y: 8 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.55, delay: startDelay + i * 0.08, ease }}
          className="rounded-xl border border-foreground/10 bg-white/[0.012] px-4 py-3"
        >
          <p className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-foreground/35 mb-1.5">
            {meta}
          </p>
          {/* Stacked, not justify-between. Long captions like
              "Unseals the AES key, reads the code" need their own line. */}
          <p className="text-[14px] font-medium leading-snug">{it.label}</p>
          <p className="mt-1 text-[12px] leading-snug text-foreground/55">
            {it.caption}
          </p>
        </motion.div>
      ))}
    </div>
  );
}

/* Three short vertical beziers converging (or diverging) from the
   row above. SVG sized to fit narrow column. */
function MobileConvergeStrip({
  kind,
  inView,
}: {
  kind: "converge" | "diverge";
  inView: boolean;
}) {
  // 3 inputs converge to 1 (seal). On diverge it's 1 → 4 but we draw
  // the same 3-strand visual for visual rhythm (the seal then expands
  // the picture into 4 outputs underneath).
  const strands =
    kind === "converge"
      ? [
          { x1: 20, x2: 50 },
          { x1: 50, x2: 50 },
          { x1: 80, x2: 50 },
        ]
      : [
          { x1: 50, x2: 18 },
          { x1: 50, x2: 39 },
          { x1: 50, x2: 61 },
          { x1: 50, x2: 82 },
        ];

  return (
    <svg
      viewBox="0 0 100 28"
      width="100%"
      height="28"
      preserveAspectRatio="xMidYMid meet"
      className="w-full h-7"
      aria-hidden
    >
      {strands.map((s, i) => (
        <motion.path
          key={i}
          d={`M ${s.x1} 0 C ${s.x1} 14, ${s.x2} 14, ${s.x2} 28`}
          stroke="currentColor"
          strokeOpacity="0.35"
          strokeWidth="0.75"
          fill="none"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={inView ? { pathLength: 1, opacity: 1 } : {}}
          transition={{ duration: 0.7, delay: 0.3 + i * 0.06, ease }}
        />
      ))}
    </svg>
  );
}

function MobileSeal({ inView }: { inView: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={inView ? { opacity: 1, scale: 1 } : {}}
      transition={{ duration: 0.6, delay: 0.4, ease }}
      className="rounded-2xl border border-foreground/25 bg-white/[0.015] px-4 py-6 flex flex-col items-center text-center"
    >
      <p className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-foreground/40 mb-5">
        THE SEAL
      </p>

      <SigillWordmark className="text-[28px] mb-5 text-foreground/95" />

      <div className="w-full h-px bg-foreground/10 mb-4" />

      <p className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-foreground/40 mb-4">
        ENCRYPTION ENGINE
      </p>
      <Image
        src="/fhenix.svg"
        alt="Fhenix"
        width={96}
        height={18}
        className="opacity-85"
      />
    </motion.div>
  );
}
