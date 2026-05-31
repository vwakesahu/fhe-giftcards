"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";

const ease = [0.165, 0.84, 0.44, 1] as const;

const steps = [
  {
    n: "01",
    title: "Pick a card",
    body: "App Store & iTunes is live today; Netflix, Spotify, Google Play, Xbox, PlayStation, Steam, and Roblox are queued behind it. Whichever you pick, the product ID is encrypted in your browser before it ever touches Base.",
  },
  {
    n: "02",
    title: "Pay in cUSDC",
    body: "Approve a sealed cUSDC allowance. Sigill consumes it as encrypted escrow. The amount never lands in plaintext.",
  },
  {
    n: "03",
    title: "Open the envelope",
    body: "A bonded observer fulfils the order, pins an AES-encrypted code to IPFS, and wraps the AES key to your wallet. Only you can unseal it.",
  },
];

export function ProductDemo() {
  const ref = useRef<HTMLDivElement | null>(null);
  const inView = useInView(ref, { once: true, margin: "-20%" });

  return (
    <section id="how" className="py-28 sm:py-36 px-6 sm:px-10">
      <div className="max-w-7xl mx-auto" ref={ref}>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, ease }}
          className="mb-12 sm:mb-16 max-w-2xl"
        >
          <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-foreground/35 mb-5">
            The flow
          </p>
          <h2 className="text-[clamp(2rem,4vw,3.25rem)] font-medium leading-[1.04] tracking-[-0.03em]">
            How an order moves
            <br />
            <span className="text-foreground/55">through Sigill.</span>
          </h2>
        </motion.div>

        {/* Vertical TOC. Three columns per row: number, title, body. */}
        <div>
          {steps.map((step, i) => (
            <Row key={step.n} step={step} index={i} inView={inView} />
          ))}
        </div>
      </div>
    </section>
  );
}

function Row({
  step,
  index,
  inView,
}: {
  step: { n: string; title: string; body: string };
  index: number;
  inView: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, delay: 0.1 + index * 0.12, ease }}
      className={`group grid grid-cols-1 md:grid-cols-12 items-start gap-y-3 md:gap-x-10 py-12 sm:py-14 ${
        index === 0
          ? "border-y border-foreground/10"
          : "border-b border-foreground/10"
      }`}
    >
      {/* Three-track magazine TOC. items-start with deliberate
          cap-height padding on the title and body so all three columns
          start at the same visual y-line. */}
      <span className="md:col-span-2 font-mono text-[clamp(2rem,4vw,3rem)] leading-none text-foreground/25 tabular-nums group-hover:text-foreground/45 transition-colors duration-500">
        {step.n}
      </span>

      <h3 className="md:col-span-4 text-2xl sm:text-[1.625rem] font-medium tracking-[-0.02em] leading-[1.15] md:pt-[6px]">
        {step.title}
      </h3>

      <p className="md:col-span-6 text-[15px] leading-[1.6] text-foreground/60 max-w-[52ch] md:pt-[10px]">
        {step.body}
      </p>
    </motion.div>
  );
}
