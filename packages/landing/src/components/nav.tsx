"use client";

import { motion, useScroll, useMotionValueEvent } from "framer-motion";
import { useState } from "react";

export function Nav() {
  const [hidden, setHidden] = useState(false);
  const { scrollY } = useScroll();

  useMotionValueEvent(scrollY, "change", (latest) => {
    setHidden(latest > 50);
  });

  return (
    <motion.header
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1, delay: 0.1 }}
      className="fixed top-0 left-0 right-0 z-50"
    >
      <motion.div
        animate={{ height: hidden ? 0 : "auto", opacity: hidden ? 0 : 1 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="bg-sp/5 border-b border-sp/10 overflow-hidden"
      >
        <div className="max-w-[1400px] mx-auto px-6 sm:px-10 py-2 flex items-center justify-center gap-3 font-mono text-[11px] text-sp">
          <span>Live on Base Sepolia</span>
          <span className="text-sp/30">&middot;</span>
          <span className="text-sp/70">Sealed by FHE</span>
        </div>
      </motion.div>
      <div className="max-w-[1400px] mx-auto px-6 sm:px-10 py-6 flex items-center justify-between mix-blend-difference">
        <a href="/" className="font-mono text-sm text-white tracking-tight">
          sigill<span className="text-white/40">_</span>
        </a>
        <div className="flex items-center gap-4">
          {/* <span className="font-mono text-[10px] text-white/40 uppercase tracking-[0.15em]">
            Base &middot; Fhenix CoFHE
          </span> */}
          <a
            href="https://app.sigill.store"
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[10px] text-white/70 hover:text-white uppercase tracking-[0.15em] border border-white/20 px-3 py-1.5 hover:border-white/60 transition-colors"
          >
            app.sigill.store &rarr;
          </a>
        </div>
      </div>
    </motion.header>
  );
}
