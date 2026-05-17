"use client";

import {
  AnimatePresence,
  motion,
  useInView,
  useReducedMotion,
} from "framer-motion";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { DEMO_CODE, DEMO_ORDER_ID } from "@/lib/constants";

const ease = [0.165, 0.84, 0.44, 1] as const;

export function ZkProof() {
  const ref = useRef<HTMLDivElement | null>(null);
  const inView = useInView(ref, { once: true, margin: "-20%" });

  return (
    <section className="py-28 sm:py-36 px-6 sm:px-10">
      <div ref={ref} className="max-w-6xl mx-auto">
        {/* Editorial header: title aligned to a narrow left column,
            supporting prose set in a wider right column. Typography
            does the structuring. No card chrome. */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-x-10 gap-y-8 mb-20 sm:mb-28">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.8, ease }}
            className="lg:col-span-5"
          >
            <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-foreground/35 mb-5">
              The reveal
            </p>
            <h2 className="text-[clamp(2rem,4vw,3.25rem)] font-medium leading-[1.04] tracking-[-0.03em]">
              Wrapped to
              <br />
              <span className="text-foreground/55">your wallet.</span>
            </h2>
          </motion.div>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.8, delay: 0.15, ease }}
            className="lg:col-span-6 lg:col-start-7 lg:pt-3 text-[15px] leading-[1.6] text-foreground/60 max-w-[52ch]"
          >
            The observer AES-encrypts your gift card code on the way in
            and pins the ciphertext to IPFS. Sigill wraps the AES key to
            your wallet using FHE. We never see it. The observer never
            sees it. Only your wallet decrypts.
          </motion.p>
        </div>

        {/* The code band. Full-width hairline rules above and below
            give it real presence as a typographic moment. No card.
            The rules are the frame. */}
        <CodeBand inView={inView} />
      </div>
    </section>
  );
}

const TARGET = DEMO_CODE;
const SCRAMBLE_GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&@*!?";

function pickGlyph() {
  return SCRAMBLE_GLYPHS[Math.floor(Math.random() * SCRAMBLE_GLYPHS.length)];
}

function CodeBand({ inView }: { inView: boolean }) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(() => TARGET.replace(/[^ ]/g, "?"));
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  // The decryption effect. On enter:
  //   1. brief pause showing scrambled glyphs (250ms)
  //   2. all unlocked positions cycle through random glyphs every ~50ms
  //   3. positions lock onto the real code one-by-one, left-to-right
  //   4. when the last position locks, reveal complete state
  // Driven by elapsed time so the timing doesn't drift across renders.
  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      setDisplay(TARGET);
      setRevealed(true);
      return;
    }

    const targets = TARGET.split("");
    // Lock time per position, left-to-right. Start at 250ms, 65ms per
    // char. Total ~1.5s for 19 chars.
    const lockAt = targets.map((_, i) => 250 + i * 65);
    let frame = 0;
    const t0 = performance.now();

    const tick = () => {
      const elapsed = performance.now() - t0;
      const next = targets.map((target, i) => {
        if (target === " ") return " ";
        return elapsed >= lockAt[i] ? target : pickGlyph();
      });
      setDisplay(next.join(""));

      if (elapsed < lockAt[lockAt.length - 1]) {
        // ~50ms tick. Slow enough to read as discrete glyphs cycling,
        // not a smooth blur. The "computery" frame rate is the point.
        frame = window.setTimeout(
          () => requestAnimationFrame(tick),
          50,
        );
      } else {
        setRevealed(true);
      }
    };

    frame = window.setTimeout(() => requestAnimationFrame(tick), 0);

    return () => {
      window.clearTimeout(frame);
    };
  }, [inView, reduce]);

  async function copy() {
    try {
      // Clipboard API is the path users actually expect; navigator.clipboard
      // can throw on insecure origins, so fall back to a hidden textarea +
      // execCommand which still works on http:// and old Safari.
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(TARGET);
      } else {
        const ta = document.createElement("textarea");
        ta.value = TARGET;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Silent. User can select the code manually as a last resort
    }
  }

  return (
    <div className="relative">
      {/* Top rule + meta */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={inView ? { opacity: 1 } : {}}
        transition={{ duration: 0.6, delay: 0.3, ease }}
        className="border-t border-foreground/10 flex items-center justify-between py-3"
      >
        <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-foreground/35">
          Gift card · #{DEMO_ORDER_ID}
        </span>
        <AnimatePresence>
          {revealed && (
            <motion.button
              key="copy"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.45, delay: 0.25, ease }}
              whileTap={{ scale: 0.96 }}
              onClick={copy}
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-foreground/65 hover:text-foreground transition-colors"
            >
              {copied ? (
                <>
                  <Check className="size-3" strokeWidth={3} />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="size-3" />
                  Copy code
                </>
              )}
            </motion.button>
          )}
        </AnimatePresence>
      </motion.div>

      {/* The decryption itself. flex justify-center for reliable
          horizontal centering. Mono + tabular-nums = each glyph has
          identical width, so the string can't reflow as characters
          scramble through to their final state. */}
      <div className="relative py-10 sm:py-14 flex justify-center">
        <span
          className={`font-mono whitespace-nowrap text-[clamp(1.1rem,4.2vw,2.5rem)] tracking-[0.06em] tabular-nums transition-colors duration-500 ${
            revealed ? "text-foreground" : "text-foreground/55"
          }`}
        >
          {display}
        </span>
      </div>

      {/* Bottom rule + caption */}
      <div className="border-t border-foreground/10 flex items-center justify-between py-3">
        <motion.span
          animate={{ opacity: revealed ? 1 : 0.6 }}
          transition={{ duration: 0.4, ease }}
          className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-foreground/35"
        >
          {revealed
            ? "Decrypted · in your browser"
            : "Sealed · awaiting your wallet"}
        </motion.span>
        <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-foreground/35">
          AES · 256
        </span>
      </div>
    </div>
  );
}
