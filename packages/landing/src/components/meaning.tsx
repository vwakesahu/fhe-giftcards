"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";

const ease = [0.16, 1, 0.3, 1] as const;

export function Meaning() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-20%" });

  return (
    <section className="py-40 px-6 sm:px-10">
      <div className="max-w-[900px] mx-auto" ref={ref}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 1, ease }}
          className="border-t border-border pt-10"
        >
          <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-sp/60 mb-6">
            si · gill &nbsp;· &nbsp;noun
          </p>

          <h3 className="font-serif text-[clamp(2rem,4vw,3.5rem)] italic leading-[1.05] tracking-[-0.02em]">
            a seal pressed in wax
            <br />
            to keep private correspondence
            <br />
            <span className="text-sp glow-text">private.</span>
          </h3>

          <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 gap-8">
            <p className="font-mono text-sm text-muted-foreground leading-relaxed">
              Kings pressed sigills onto letters so couriers couldn&rsquo;t read
              them. Monks pressed them onto ledgers so the wrong eyes
              couldn&rsquo;t skim. A sigill was a promise: this is sealed, and
              opening it without permission means you broke the seal.
            </p>
            <p className="font-mono text-sm text-muted-foreground leading-relaxed">
              That promise mostly vanished from money. Every transaction is a
              postcard now. So we went and made a new seal — pressed in
              ciphertext instead of wax. It still means the same thing: what
              you bought is yours, and nobody opens the envelope but you.
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
