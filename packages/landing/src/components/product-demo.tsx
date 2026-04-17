"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";

const ease = [0.16, 1, 0.3, 1] as const;

const lifecycle = [
  {
    step: "01",
    title: "Buyer places order",
    body: "Product ID and ETH amount encrypt in the browser with Fhenix CoFHE. Funds lock on Base.",
  },
  {
    step: "02",
    title: "Observer decrypts privately",
    body: "A bonded observer is granted FHE access — just enough to know what to buy, and for how much.",
  },
  {
    step: "03",
    title: "Gift card delivered sealed",
    body: "Observer buys the card, AES-encrypts the code, pins it to IPFS, releases the escrow.",
  },
  {
    step: "04",
    title: "Buyer unseals",
    body: "Only the buyer can decrypt the AES key via FHE. Chain never sees the code, the product, or the amount.",
  },
];

export function ProductDemo() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-15%" });

  return (
    <section id="demo" className="py-40 px-6 sm:px-10">
      <div className="max-w-[1400px] mx-auto">
        <motion.div
          ref={ref}
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : {}}
          transition={{ duration: 1, ease }}
          className="mb-24 flex flex-col sm:flex-row sm:items-end justify-between gap-6"
        >
          <h2 className="font-serif text-[clamp(2.5rem,5vw,5rem)] leading-[0.95] tracking-[-0.02em]">
            Checkout, but
            <br />
            <span className="italic text-sp glow-text">sealed</span>
          </h2>
          <p className="font-mono text-xs text-muted-foreground max-w-xs leading-relaxed">
            The buyer picks a product, the chain sees a ciphertext, and a
            bonded observer delivers the goods without ever touching the
            clear amount.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-px bg-border">
          {lifecycle.map((item, i) => (
            <motion.div
              key={item.step}
              initial={{ opacity: 0, y: 30 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.8, delay: 0.1 + i * 0.1, ease }}
              className="bg-background p-10 sm:p-12 flex flex-col gap-8 min-h-[360px]"
            >
              <p className="font-mono text-[10px] tracking-[0.3em] text-sp/60 uppercase">
                {item.step}
              </p>
              <h3 className="font-serif text-2xl italic leading-tight">
                {item.title}
              </h3>
              <p className="font-mono text-xs text-muted-foreground/70 leading-relaxed mt-auto">
                {item.body}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
