"use client";

import { motion } from "framer-motion";

const ease = [0.16, 1, 0.3, 1] as const;

export function Hero() {
  return (
    <section className="relative min-h-svh flex flex-col justify-end pb-20 sm:pb-28 overflow-hidden">
      {/* Ambient glow — cyan + green */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-sp/[0.03] rounded-full blur-[180px] pointer-events-none" />
      <div className="absolute top-20 left-1/4 w-[400px] h-[300px] bg-cyan/[0.02] rounded-full blur-[120px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, ease }}
        className="relative z-10 max-w-[1400px] mx-auto px-6 sm:px-10 w-full"
      >

        <div className="overflow-hidden">
          <motion.h1
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            transition={{ duration: 1, delay: 0.2, ease }}
            className="font-serif text-[clamp(3rem,8vw,8rem)] leading-[0.9] tracking-[-0.02em]"
          >
            Checkout that
          </motion.h1>
        </div>
        <div className="overflow-hidden">
          <motion.h1
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            transition={{ duration: 1, delay: 0.3, ease }}
            className="font-serif text-[clamp(3rem,8vw,8rem)] leading-[0.9] tracking-[-0.02em] italic text-sp glow-text pb-8"
          >
            nobody can see
          </motion.h1>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.5, ease }}
          className="mt-12 flex flex-col sm:flex-row sm:items-end justify-between gap-8"
        >
          <p className="max-w-md text-muted-foreground leading-relaxed font-mono text-sm">
            Amounts stay encrypted end-to-end. Settlement and redemption happen without ever revealing what you paid. Powered by Fhenix CoFHE on Base.
          </p>
          <span className="font-mono text-xs text-sp/50 uppercase tracking-[0.15em]">
            Live on Base Sepolia
          </span>
        </motion.div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1, delay: 0.8 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
      >
        <div className="w-px h-12 bg-gradient-to-b from-transparent via-sp/30 to-transparent" />
      </motion.div>
    </section>
  );
}
