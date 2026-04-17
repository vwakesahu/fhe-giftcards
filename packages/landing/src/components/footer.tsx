"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import Image from "next/image";

const ease = [0.16, 1, 0.3, 1] as const;

const closingLines = [
  "> no surveillance",
  "> no exposure",
  "> no compromise",
  ">",
  "> sigill.sol ready \u2713",
  "> base sepolia: live",
  "> fhe: default \u2713",
];

export function Footer() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-10%" });

  return (
    <footer className="px-6 sm:px-10 pt-40 pb-10">
      <div className="max-w-[1400px] mx-auto">
        {/* Terminal closing */}
        <motion.div
          ref={ref}
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : {}}
          transition={{ duration: 1, ease }}
          className="mb-20"
        >
          <div className="font-mono text-sm space-y-2 mb-16">
            {closingLines.map((line, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={isInView ? { opacity: 1, x: 0 } : {}}
                transition={{ duration: 0.4, delay: i * 0.12, ease }}
                className={
                  line.includes("\u2713") ? "text-sp glow-text" : "text-sp/50"
                }
              >
                {line}
              </motion.div>
            ))}
          </div>

          {/* Tagline */}
          <div className="flex items-baseline gap-4">
            {["PAID.", "PRIVATE.", "PERIOD."].map((word, i) => (
              <motion.span
                key={word}
                initial={{ opacity: 0, y: 20 }}
                animate={isInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.8, delay: 1.2 + i * 0.2, ease }}
                className="font-mono text-[clamp(1.5rem,3vw,3rem)] tracking-[0.1em] text-sp glow-text"
              >
                {word}
              </motion.span>
            ))}
          </div>
        </motion.div>

        {/* Bottom bar */}
        <div className="border-t border-border pt-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="font-mono text-xs text-muted-foreground">
            sigill<span className="text-muted-foreground/40">_</span>
          </div>
          <a
            href="https://fhenix.io"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-3 font-mono text-[10px] text-muted-foreground/50 tracking-[0.15em] uppercase hover:text-muted-foreground transition-colors"
          >
            <span>Powered by</span>
            <Image
              src="/fhenix.svg"
              alt="Fhenix"
              width={72}
              height={16}
              className="opacity-60 group-hover:opacity-100 transition-opacity"
            />
          </a>
          <div className="font-mono text-[10px] text-muted-foreground/40">
            Privacy by default
          </div>
        </div>
      </div>
    </footer>
  );
}
