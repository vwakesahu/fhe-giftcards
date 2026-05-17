"use client";

import { motion, useInView } from "framer-motion";
import Image from "next/image";
import { useRef } from "react";

import {
  APP_URL,
  BRAND_NAME,
  CTA_OPEN_APP,
  CTA_VIEW_GITHUB,
  FHENIX_URL,
  GITHUB_URL,
} from "@/lib/constants";
import { GithubGlyph, SigillWordmark } from "./icons";

const ease = [0.165, 0.84, 0.44, 1] as const;

export function Footer() {
  const ref = useRef<HTMLDivElement | null>(null);
  const inView = useInView(ref, { once: true, margin: "-10%" });

  return (
    <footer className="px-6 sm:px-8 pt-24 sm:pt-32 pb-10">
      <div ref={ref} className="max-w-6xl mx-auto">
        {/* Closing CTA: one last clear ask. */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, ease }}
          className="mb-20 sm:mb-28 max-w-3xl"
        >
          <h2 className="text-[clamp(2rem,5.5vw,4.5rem)] font-medium leading-[1.02] tracking-[-0.035em]">
            Spend in private.
            <br />
            <span className="text-foreground/55">Settle on Base.</span>
          </h2>

          <div className="mt-10 flex items-center gap-3 flex-wrap">
            <a
              href={APP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-2 rounded-full bg-foreground text-background pl-5 pr-4 py-3 text-[14px] font-medium hover:opacity-90 transition-opacity"
            >
              {CTA_OPEN_APP}
              <span aria-hidden>→</span>
            </a>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-foreground/20 px-4 py-3 text-[14px] font-medium text-foreground/85 hover:bg-foreground/5 hover:text-foreground transition-colors"
            >
              <GithubGlyph />
              {CTA_VIEW_GITHUB}
            </a>
          </div>
        </motion.div>

        {/* Bottom line: just the essentials. */}
        <div className="border-t border-foreground/10 pt-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-[13px] text-foreground/55">
          <SigillWordmark className="text-[15px] text-foreground/85" />
          {/* BRAND_NAME export still wins the page title + a11y labels;
              the wordmark renders the visible mark. */}

          <div className="flex items-center gap-5">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${BRAND_NAME} on GitHub`}
              className="inline-flex items-center text-foreground/55 hover:text-foreground transition-colors"
            >
              <GithubGlyph />
            </a>
            <a
              href={FHENIX_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-2 hover:text-foreground transition-colors"
            >
              <span>Built with</span>
              <Image
                src="/fhenix.svg"
                alt="Fhenix"
                width={64}
                height={14}
                className="opacity-60 group-hover:opacity-100 transition-opacity"
              />
            </a>
          </div>

          <span>&copy; {new Date().getFullYear()} {BRAND_NAME}</span>
        </div>
      </div>
    </footer>
  );
}
