"use client";

import { motion, useMotionValueEvent, useScroll } from "framer-motion";
import { useState } from "react";

import { APP_URL, BRAND_NAME, CTA_OPEN_APP_SHORT, GITHUB_URL } from "@/lib/constants";
import { GithubGlyph, SigillWordmark } from "./icons";

const ease = [0.165, 0.84, 0.44, 1] as const;

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const { scrollY } = useScroll();

  useMotionValueEvent(scrollY, "change", (y) => {
    setScrolled(y > 12);
  });

  return (
    <motion.header
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease }}
      className="fixed top-0 inset-x-0 z-50"
    >
      <motion.div
        animate={{
          backgroundColor: scrolled
            ? "rgba(13, 12, 10, 1)"
            : "rgba(13, 12, 10, 0)",
          borderColor: scrolled
            ? "rgba(240, 236, 228, 0.06)"
            : "rgba(240, 236, 228, 0)",
        }}
        transition={{ duration: 0.3, ease }}
        className="border-b"
      >
        <div className="max-w-6xl mx-auto px-6 sm:px-8 h-14 flex items-center justify-between">
          <a
            href="/"
            className="inline-flex items-baseline gap-2 text-foreground"
            aria-label={BRAND_NAME}
          >
            <SigillWordmark className="text-[20px]" />
          </a>

          <div className="flex items-center gap-5 sm:gap-6">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${BRAND_NAME} on GitHub`}
              className="inline-flex items-center text-foreground/60 hover:text-foreground transition-colors"
            >
              <GithubGlyph />
            </a>
            <a
              href={APP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-1.5 text-[13px] font-medium text-foreground/80 hover:text-foreground transition-colors"
            >
              {CTA_OPEN_APP_SHORT}
              <motion.span
                aria-hidden
                className="inline-block"
                initial={{ x: 0 }}
                whileHover={{ x: 2 }}
                transition={{ duration: 0.2, ease }}
              >
                →
              </motion.span>
            </a>
          </div>
        </div>
      </motion.div>
    </motion.header>
  );
}
