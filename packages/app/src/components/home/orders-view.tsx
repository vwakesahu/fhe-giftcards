"use client";

import Link from "next/link";
import { useAccount, usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "motion/react";
import { ArrowRight, Lock, Inbox, TriangleAlert } from "lucide-react";

import { addresses, sigillAbi, ORDER_STATUS } from "@/lib/contracts";
import { shortAddr, shortHandle } from "@/lib/format";
import { EASE_OUT } from "@/lib/motion";
import { Spinner } from "@/components/spinner";

type OrderRow = {
  orderId: bigint;
  buyer: `0x${string}`;
  observer: `0x${string}`;
  encProductId: bigint;
  encPaid: bigint;
  deadline: bigint;
  status: number;
};

export function OrdersView() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();

  const { data: orders = [], isLoading, error, refetch } = useQuery({
    enabled: !!publicClient && !!address && !!addresses.sigill,
    queryKey: ["orders", address, addresses.sigill],
    queryFn: async (): Promise<OrderRow[]> => {
      if (!publicClient || !address) return [];
      const latest = await publicClient.getBlockNumber();
      const from = latest > 10_000n ? latest - 10_000n : 0n;
      // Sigill emits OrderInProccessed (sic) for slotted-active orders and
      // OrderInQueued for waitlisted ones. Buyer wants to see both lists.
      const [activeLogs, queuedLogs] = await Promise.all([
        publicClient.getContractEvents({
          address: addresses.sigill,
          abi: sigillAbi,
          eventName: "OrderInProccessed",
          args: { buyer: address },
          fromBlock: from,
          toBlock: latest,
        }),
        publicClient.getContractEvents({
          address: addresses.sigill,
          abi: sigillAbi,
          eventName: "OrderInQueued",
          args: { buyer: address },
          fromBlock: from,
          toBlock: latest,
        }),
      ]);
      const logs = [...activeLogs, ...queuedLogs];
      const rows = await Promise.all(
        logs.map(async (log) => {
          const order = await publicClient.readContract({
            address: addresses.sigill,
            abi: sigillAbi,
            functionName: "getOrder",
            args: [log.args.orderId!],
          });
          return {
            orderId: log.args.orderId!,
            buyer: order[0],
            observer: order[1],
            encProductId: order[2],
            encPaid: order[3],
            deadline: order[6],
            status: Number(order[7]),
          } satisfies OrderRow;
        }),
      );
      return rows.sort((a, b) => Number(b.orderId - a.orderId));
    },
    refetchInterval: 10_000,
  });

  const stats = computeStats(orders);

  return (
    <>
      <Header hasOrders={orders.length > 0} isConnected={isConnected} />
      <StatsRow stats={stats} />
      <section className="mt-10">
        <AnimatePresence mode="wait" initial={false}>
          {!isConnected ? (
            <EmptyState
              key="off"
              icon={<Lock className="size-5" />}
              title="Connect a wallet"
              body="Your sealed orders are bound to your wallet. Nothing loads without it."
            />
          ) : error ? (
            <EmptyState
              key="err"
              icon={<TriangleAlert className="size-5" />}
              title="Couldn't load orders"
              body={error instanceof Error ? error.message.slice(0, 140) : "RPC call failed."}
              action={{ label: "Retry", onClick: () => refetch() }}
            />
          ) : isLoading ? (
            <LoadingState key="load" />
          ) : orders.length === 0 ? (
            <EmptyState
              key="empty"
              icon={<Inbox className="size-5" />}
              title="No orders yet"
              body="Place your first sealed order and it'll show up here."
              action={{ label: "New order", href: "/buy" }}
            />
          ) : (
            <Table key="table" rows={orders} />
          )}
        </AnimatePresence>
      </section>
    </>
  );
}

// ───── Header ───────────────────────────────────────────────

function Header({ hasOrders, isConnected }: { hasOrders: boolean; isConnected: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE_OUT }}
      className="flex items-center justify-between gap-6 flex-wrap"
    >
      <div>
        <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-foreground">
          Orders
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground/75 leading-relaxed">
          Sealed checkout activity. What you bought, how much you paid — only your wallet can open it.
        </p>
      </div>
      {hasOrders && isConnected && <PrimaryCTA href="/buy">New order</PrimaryCTA>}
    </motion.div>
  );
}

function PrimaryCTA({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 h-9 px-4 text-[13px] font-medium bg-sp text-[#050505] hover:bg-sp/90 transition-colors rounded-full"
    >
      {children}
      <ArrowRight className="size-3.5" />
    </Link>
  );
}

// ───── Stats ────────────────────────────────────────────────

function computeStats(orders: OrderRow[]) {
  // Matches the new Status enum (Observer.sol):
  // 0 Pending · 1 Processing · 2 Fulfilled · 3 Refunded · 4 Rejected · 5 Queued
  // We bucket Processing + Queued under "pending" for the stat header — both
  // are in-flight from the buyer's POV.
  const pending = orders.filter(
    (o) => o.status === 0 || o.status === 1 || o.status === 5,
  ).length;
  const fulfilled = orders.filter((o) => o.status === 2).length;
  const refunded = orders.filter((o) => o.status === 3).length;
  const rejected = orders.filter((o) => o.status === 4).length;
  return { total: orders.length, pending, fulfilled, refunded, rejected };
}

function StatsRow({ stats }: { stats: ReturnType<typeof computeStats> }) {
  const items = [
    { label: "Total", value: stats.total },
    { label: "Pending", value: stats.pending },
    { label: "Fulfilled", value: stats.fulfilled },
    { label: "Refunded + rejected", value: stats.refunded + stats.rejected },
  ];
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.08, ease: EASE_OUT }}
      className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-3"
    >
      {items.map((s) => (
        <div key={s.label} className="rounded-2xl border border-white/[0.06] p-4">
          <p className="text-[12px] text-muted-foreground/55 truncate">{s.label}</p>
          <p className="mt-2 text-[24px] font-semibold tabular-nums tracking-tight leading-none">
            {s.value}
          </p>
        </div>
      ))}
    </motion.div>
  );
}

// ───── Table ────────────────────────────────────────────────

function Table({ rows }: { rows: OrderRow[] }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-2xl border border-white/[0.06] overflow-hidden"
    >
      <div className="grid grid-cols-[70px_minmax(0,1fr)_minmax(0,1fr)_120px_36px] h-8 items-center px-4 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground/50 border-b border-white/[0.06]">
        <span>ID</span>
        <span>Payment handle</span>
        <span>Observer</span>
        <span>Status</span>
        <span />
      </div>
      <div>
        {rows.map((o, i) => (
          <Row key={String(o.orderId)} order={o} first={i === 0} />
        ))}
      </div>
    </motion.div>
  );
}

function Row({ order, first }: { order: OrderRow; first: boolean }) {
  const status = ORDER_STATUS[order.status] ?? "Pending";
  // Processing + Queued are both "in flight to the user" — render them with
  // the same accent as Pending so the row colour stays consistent across the
  // observer-side state machine transitions.
  const statusClass: Record<string, string> = {
    Pending: "text-sp bg-sp/[0.06]",
    Processing: "text-sp bg-sp/[0.06]",
    Queued: "text-sp bg-sp/[0.06]",
    Fulfilled: "text-cyan bg-cyan/[0.06]",
    Refunded: "text-muted-foreground/70 bg-white/[0.04]",
    Rejected: "text-destructive bg-destructive/[0.06]",
  };
  return (
    <Link
      href={`/order/${order.orderId}`}
      className={`group grid grid-cols-[70px_minmax(0,1fr)_minmax(0,1fr)_120px_36px] h-11 items-center px-4 hover:bg-white/[0.03] transition-colors ${
        first ? "" : "border-t border-white/[0.04]"
      }`}
    >
      <span className="text-[13px] font-medium tabular-nums text-foreground/95">
        #{String(order.orderId).padStart(3, "0")}
      </span>
      <span className="font-mono text-[12px] text-foreground/60 truncate">
        {shortHandle(order.encPaid, 6)}
      </span>
      <span className="font-mono text-[12px] text-foreground/60">
        {shortAddr(order.observer, 6, 4)}
      </span>
      <span
        className={`inline-flex h-6 items-center px-2.5 rounded-full text-[11px] font-medium ${statusClass[status]}`}
      >
        {status}
      </span>
      <ArrowRight className="size-3.5 text-muted-foreground/30 group-hover:text-foreground group-hover:translate-x-0.5 transition-all justify-self-end" />
    </Link>
  );
}

// ───── Empty / skeleton ─────────────────────────────────────

type EmptyAction =
  | { label: string; href: string }
  | { label: string; onClick: () => void };

function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: EmptyAction;
}) {
  const actionClass =
    "mt-3 inline-flex items-center gap-2 h-8 px-3 text-[12px] font-medium border border-white/10 hover:bg-white/[0.04] rounded-full transition-colors";
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, ease: EASE_OUT }}
      className="rounded-2xl border border-white/[0.06] flex flex-col items-center justify-center text-center gap-3 py-16 px-6"
    >
      <div className="text-muted-foreground/35">{icon}</div>
      <p className="text-[14px] font-medium">{title}</p>
      <p className="text-[13px] text-muted-foreground/55 max-w-sm leading-relaxed">{body}</p>
      {action && "href" in action ? (
        <Link href={action.href} className={actionClass}>
          {action.label}
          <ArrowRight className="size-3" />
        </Link>
      ) : action ? (
        <button onClick={action.onClick} className={actionClass}>
          {action.label}
          <ArrowRight className="size-3" />
        </button>
      ) : null}
    </motion.div>
  );
}

function LoadingState() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="rounded-2xl border border-white/[0.06] flex items-center justify-center gap-2.5 py-16 text-[12.5px] text-muted-foreground/65"
    >
      <Spinner size={14} className="text-sp" />
      Loading orders
    </motion.div>
  );
}
