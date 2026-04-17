"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";

const ease = [0.16, 1, 0.3, 1] as const;

const stack = [
  { layer: "Runtime", tech: "Base" },
  { layer: "Encryption", tech: "Fhenix CoFHE" },
  { layer: "Language", tech: "Solidity" },
  { layer: "Storage", tech: "IPFS + AES" },
  { layer: "Delivery", tech: "Reloadly" },
  { layer: "Settlement", tech: "On-chain" },
];

export function TechStack() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-15%" });

  return (
    <section id="stack" className="py-40 px-6 sm:px-10">
      <div className="max-w-[1400px] mx-auto">
        <motion.div
          ref={ref}
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : {}}
          transition={{ duration: 1, ease }}
          className="mb-24 flex flex-col sm:flex-row sm:items-end justify-between gap-6"
        >
          <h2 className="font-serif text-[clamp(2.5rem,5vw,5rem)] leading-[0.95] tracking-[-0.02em]">
            Built on
            <br />
            <span className="italic text-sp glow-text">fully homomorphic encryption</span>
          </h2>
        </motion.div>

        <div>
          {stack.map((item, i) => (
            <StackRow key={item.layer} item={item} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

function StackRow({
  item,
  index,
}: {
  item: (typeof stack)[0];
  index: number;
}) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-5%" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0 }}
      animate={isInView ? { opacity: 1 } : {}}
      transition={{ duration: 0.5, delay: index * 0.05, ease }}
      className="group flex items-baseline justify-between border-t border-border py-5 hover:pl-2 transition-all duration-500"
    >
      <span className="font-mono text-xs text-muted-foreground uppercase tracking-[0.15em]">
        {item.layer}
      </span>
      <span className="font-serif text-lg italic group-hover:text-sp transition-colors duration-500">
        {item.tech}
      </span>
    </motion.div>
  );
}
