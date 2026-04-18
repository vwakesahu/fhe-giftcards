"use client";

import { motion } from "motion/react";
import { Check, Clock, Server } from "lucide-react";

import { OBSERVERS } from "@/lib/contracts";
import { EASE_OUT } from "@/lib/motion";
import { shortAddr } from "@/lib/format";

export function ObserverStep({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { staggerChildren: 0.04 } }}
      className="rounded-2xl border border-white/6 overflow-hidden"
    >
      {OBSERVERS.map((o, i) => {
        const disabled = o.status !== "online";
        const active = selectedId === o.id;
        return (
          <motion.button
            key={o.id}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, ease: EASE_OUT }}
            onClick={disabled ? undefined : () => onSelect(o.id)}
            disabled={disabled}
            className={`group relative grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto_36px] items-center gap-5 w-full h-16 px-5 text-left transition-colors ${
              i === 0 ? "" : "border-t border-white/4"
            } ${
              disabled
                ? "opacity-50 cursor-not-allowed"
                : active
                ? "bg-white/3"
                : "hover:bg-white/3"
            }`}
          >
            {active && !disabled && (
              <motion.span
                layoutId="observer-indicator"
                className="absolute left-0 top-2 bottom-2 w-[2px] bg-sp rounded-r-sm"
                transition={{ type: "spring", duration: 0.4, bounce: 0.18 }}
              />
            )}
            <Server
              className={`size-3.5 ${disabled ? "text-muted-foreground/30" : "text-muted-foreground/60"}`}
              strokeWidth={1.6}
            />
            <div className="min-w-0">
              <p className="text-[13px] font-medium truncate">{o.name}</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground/55">{o.region}</p>
            </div>
            <span className="font-mono text-[12px] text-muted-foreground/55 truncate">
              {o.address ? shortAddr(o.address, 6, 4) : "—"}
            </span>
            {disabled ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground/45">
                <Clock className="size-3" />
                Coming soon
              </span>
            ) : (
              <span className="text-[11px] font-medium text-sp/85">Available</span>
            )}
            <span
              className={`size-5 rounded-full flex items-center justify-center ${
                active
                  ? "bg-sp text-[#050505]"
                  : disabled
                  ? "border border-white/6 text-transparent"
                  : "border border-white/8 text-transparent group-hover:border-white/20"
              }`}
            >
              <Check className="size-3" strokeWidth={3} />
            </span>
          </motion.button>
        );
      })}
    </motion.div>
  );
}

