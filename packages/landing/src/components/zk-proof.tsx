"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";

const ease = [0.16, 1, 0.3, 1] as const;

const capabilities = [
  {
    token: "euint64",
    title: "Compute on ciphertexts",
    body: "FHE lets the contract add, compare, and allow access without ever decrypting. The amount stays sealed while being checked.",
  },
  {
    token: "FHE.allow",
    title: "Scoped decryption",
    body: "The buyer's browser encrypts. The contract grants targeted access — the observer sees enough to fulfill, and nothing more.",
  },
  {
    token: "AES + IPFS",
    title: "Off-chain payload",
    body: "The gift card code is AES-encrypted, pinned to IPFS, and unlocked only by a buyer-decryptable FHE key.",
  },
];

export function ZkProof() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-15%" });

  return (
    <section id="proof" className="py-40 px-6 sm:px-10">
      <div className="max-w-[1400px] mx-auto">
        <motion.div
          ref={ref}
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : {}}
          transition={{ duration: 1, ease }}
          className="mb-24 flex flex-col sm:flex-row sm:items-end justify-between gap-6"
        >
          <h2 className="font-serif text-[clamp(2.5rem,5vw,5rem)] leading-[0.95] tracking-[-0.02em]">
            Nothing decrypts.
            <br />
            <span className="italic text-sp glow-text">Everything still runs.</span>
          </h2>
          <p className="font-mono text-xs text-muted-foreground max-w-xs leading-relaxed">
            Fhenix CoFHE lets Solidity operate directly on encrypted
            integers. No trusted execution, no custodian, no reveal.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-border">
          {capabilities.map((c, i) => (
            <motion.div
              key={c.token}
              initial={{ opacity: 0, y: 30 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.8, delay: i * 0.12, ease }}
              className="bg-background p-10 sm:p-14 flex flex-col gap-6 min-h-[320px]"
            >
              <p className="font-mono text-[10px] tracking-[0.3em] text-cyan/60 uppercase">
                {c.token}
              </p>
              <h3 className="font-serif text-2xl italic leading-tight">
                {c.title}
              </h3>
              <p className="font-mono text-xs text-muted-foreground/70 leading-relaxed mt-auto">
                {c.body}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
