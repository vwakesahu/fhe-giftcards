"use client";

import { motion } from "motion/react";
import { Check, Server, Inbox, AlertTriangle } from "lucide-react";

import { useObservers } from "@/hooks/use-observers";
import { type ObserverEntry } from "@/lib/contracts";
import { EASE_OUT } from "@/lib/motion";
import { shortAddr } from "@/lib/format";
import { Spinner } from "@/components/spinner";

export function ObserverStep({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { observers, isLoading, error } = useObservers();

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-white/[0.06] flex items-center justify-center gap-2.5 py-16 text-[12.5px] text-muted-foreground/65">
        <Spinner size={14} className="text-sp" />
        Loading relays
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-white/[0.06] flex flex-col items-center justify-center text-center gap-3 py-16 px-6">
        <AlertTriangle className="size-5 text-muted-foreground/35" />
        <p className="text-[14px] font-medium">Couldn&apos;t load relays</p>
        <p className="text-[13px] text-muted-foreground/55 max-w-sm leading-relaxed">
          {error.message.slice(0, 160)}
        </p>
      </div>
    );
  }

  if (observers.length === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.06] flex flex-col items-center justify-center text-center gap-3 py-16 px-6">
        <Inbox className="size-5 text-muted-foreground/35" />
        <p className="text-[14px] font-medium">No relays registered yet</p>
        <p className="text-[13px] text-muted-foreground/55 max-w-sm leading-relaxed">
          Once an operator bonds 0.01 ETH on Sigill they show up here.
        </p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { staggerChildren: 0.04 } }}
      className="rounded-2xl border border-white/6 overflow-hidden"
    >
      {observers.map((o, i) => (
        <ObserverRow
          key={o.id}
          observer={o}
          index={i}
          first={i === 0}
          active={selectedId === o.id}
          onSelect={() => onSelect(o.id)}
        />
      ))}
    </motion.div>
  );
}

function ObserverRow({
  observer,
  index,
  first,
  active,
  onSelect,
}: {
  observer: ObserverEntry;
  index: number;
  first: boolean;
  active: boolean;
  onSelect: () => void;
}) {
  const disabled = observer.status !== "online";
  const completedLabel =
    observer.ordersCompleted > 0n
      ? `${observer.ordersCompleted} fulfilled`
      : "new relay";
  const queueLabel = `${observer.slotLeft.toString()}/${observer.slotSize.toString()} slots`;

  return (
    <motion.button
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: EASE_OUT }}
      onClick={disabled ? undefined : onSelect}
      disabled={disabled}
      className={`group relative grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto_36px] items-center gap-5 w-full h-16 px-5 text-left transition-colors ${
        first ? "" : "border-t border-white/4"
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
        <p className="text-[13px] font-medium truncate">
          Relay {String(index + 1).padStart(2, "0")}
        </p>
        <p className="mt-0.5 text-[12px] text-muted-foreground/55 tabular-nums">
          {completedLabel} · {queueLabel}
        </p>
      </div>
      <span className="font-mono text-[12px] text-muted-foreground/55 truncate">
        {shortAddr(observer.address, 6, 4)}
      </span>
      {disabled ? (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-destructive/85">
          Queue full
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
}
