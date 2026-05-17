"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";

import { CTA_READ_GITHUB, GITHUB_URL } from "@/lib/constants";

const ease = [0.165, 0.84, 0.44, 1] as const;

type Commitment = {
  title: string;
  body: string;
  href?: string;
  linkLabel?: string;
};

const commitments: Commitment[] = [
  {
    title: "Encrypted in your browser",
    body: "The product ID and your sealed allowance are encrypted with Fhenix CoFHE before any transaction is signed. No server holds plaintext.",
  },
  {
    title: "Scoped decrypt permission",
    body: "FHE.allow grants the observer decrypt access to the product ID and the paid amount, nothing else. The AES key is wrapped to your wallet only.",
  },
  {
    title: "Bonded, time-bound observers",
    body: "Observers post a 0.01 ETH bond. If they miss the 10 minute deadline, you refund yourself and 50 percent of their bond is slashed.",
  },
  {
    title: "Open source on Base Sepolia",
    body: "Sigill, ConfidentialERC20, and the Observer contract are public on Base Sepolia. Read the source, verify the bytecode.",
    href: GITHUB_URL,
    linkLabel: CTA_READ_GITHUB,
  },
];

export function TechStack() {
  const ref = useRef<HTMLDivElement | null>(null);
  const inView = useInView(ref, { once: true, margin: "-15%" });

  return (
    <section id="trust" className="py-28 sm:py-36 px-6 sm:px-10">
      <div className="max-w-7xl mx-auto" ref={ref}>
        {/* The title sits in the 4-column gutter, the list runs in the
            wide right column , a single asymmetric spread, not a
            stacked header + grid. */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-x-10 gap-y-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.8, ease }}
            className="lg:col-span-4 lg:sticky lg:top-32 lg:self-start"
          >
            <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-foreground/35 mb-5">
              Trust
            </p>
            <h2 className="text-[clamp(2rem,3.4vw,3rem)] font-medium leading-[1.04] tracking-[-0.03em]">
              What stays
              <br />
              <span className="text-foreground/55">private.</span>
            </h2>
          </motion.div>

          <ol className="lg:col-span-8 border-t border-foreground/10">
            {commitments.map((c, i) => (
              <CommitRow
                key={c.title}
                index={i}
                title={c.title}
                body={c.body}
                href={c.href}
                linkLabel={c.linkLabel}
                inView={inView}
              />
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function CommitRow({
  index,
  title,
  body,
  href,
  linkLabel,
  inView,
}: {
  index: number;
  title: string;
  body: string;
  href?: string;
  linkLabel?: string;
  inView: boolean;
}) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 12 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, delay: 0.15 + index * 0.1, ease }}
      className="border-b border-foreground/10 py-9 sm:py-11 grid grid-cols-[44px_1fr] gap-x-6 items-baseline"
    >
      <span className="font-mono text-[10.5px] text-foreground/35 tabular-nums pt-1">
        {String(index + 1).padStart(2, "0")}
      </span>

      <div>
        <h3 className="text-xl sm:text-[1.5rem] font-medium tracking-[-0.015em]">
          {title}
        </h3>
        <p className="mt-3 text-[15px] leading-[1.6] text-foreground/60 max-w-[58ch]">
          {body}
        </p>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="group mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-foreground/75 hover:text-foreground transition-colors"
          >
            {linkLabel ?? "Read more"}
            <span aria-hidden className="inline-block transition-transform group-hover:translate-x-0.5">
              →
            </span>
          </a>
        )}
      </div>
    </motion.li>
  );
}
