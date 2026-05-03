"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Copy, Check, Lock, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { addresses, sigillAbi, ORDER_STATUS } from "@/lib/contracts";
import { FheTypes } from "@cofhe/sdk";

import { ensureCofheConnected } from "@/lib/cofhe";
import { shortAddr, shortHandle } from "@/lib/format";
import { EASE_OUT } from "@/lib/motion";
import { Identicon } from "@/components/identicon";
import { Spinner } from "@/components/spinner";

const STATUS_META: Record<string, { tone: string; tint: string; headline: string; body: string }> = {
  Pending: {
    tone: "text-sp",
    tint: "bg-sp/6",
    headline: "Relay working",
    body: "The observer has decryption permission on your product + payment. Waiting for fulfilment.",
  },
  Fulfilled: {
    tone: "text-cyan",
    tint: "bg-cyan/6",
    headline: "Envelope delivered",
    body: "The gift card is AES-sealed on IPFS. Your wallet is the only one that can open it.",
  },
  Refunded: {
    tone: "text-muted-foreground",
    tint: "bg-white/4",
    headline: "Refunded",
    body: "Escrow returned. The observer's bond was slashed 50% for missing the deadline.",
  },
  Rejected: {
    tone: "text-destructive",
    tint: "bg-destructive/6",
    headline: "Rejected by observer",
    body: "The observer declined the order. Your escrow was returned.",
  },
};

export function OrderDetail({ orderId }: { orderId: string }) {
  const publicClient = usePublicClient();
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();

  const idBig = useMemo(() => {
    try {
      return BigInt(orderId);
    } catch {
      return null;
    }
  }, [orderId]);

  const { data: order, refetch } = useQuery({
    enabled: !!publicClient && idBig !== null,
    queryKey: ["order", orderId],
    queryFn: async () => {
      if (!publicClient || idBig === null) return null;
      const o = await publicClient.readContract({
        address: addresses.sigill,
        abi: sigillAbi,
        functionName: "getOrder",
        args: [idBig],
      });
      return {
        buyer: o[0],
        observer: o[1],
        encProductId: o[2],
        encPaid: o[3],
        encAesKey: o[4],
        ipfsCid: o[5],
        deadline: o[6],
        status: Number(o[7]),
      };
    },
    refetchInterval: 5_000,
  });

  const status = order ? ORDER_STATUS[order.status] : "Pending";
  const meta = STATUS_META[status];
  const isBuyer = !!order && !!address && order.buyer.toLowerCase() === address.toLowerCase();

  return (
    <>
      {/* Breadcrumb */}
      <motion.div
        initial={{ opacity: 0, y: -2 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 h-7 text-[12px] font-medium text-muted-foreground/65 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          All orders
        </Link>
      </motion.div>

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE_OUT }}
        className="mt-4 flex items-center justify-between gap-6 flex-wrap"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-[20px] font-semibold tracking-[-0.01em] tabular-nums">
              Order #{String(idBig ?? orderId).padStart(3, "0")}
            </h1>
            <span
              className={`inline-flex items-center h-6 px-2.5 rounded-full text-[11px] font-medium ${meta?.tone} ${meta?.tint}`}
            >
              {status}
            </span>
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground/70 leading-relaxed max-w-xl">
            {meta?.headline}. {meta?.body}
          </p>
        </div>
      </motion.div>

      {/* Body grid */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-[1.5fr_1fr] gap-3">
        <RevealPanel
          status={status}
          order={order}
          isBuyer={isBuyer}
          onRefetch={refetch}
          publicClient={publicClient}
          walletClient={walletClient}
        />
        <Metadata order={order} />
      </div>
    </>
  );
}

// ───── Reveal panel ──────────────────────────────────────────

function RevealPanel({
  status,
  order,
  isBuyer,
  onRefetch,
  publicClient,
  walletClient,
}: {
  status: string;
  order:
    | {
        ipfsCid: string;
        encAesKey: bigint;
      }
    | null
    | undefined;
  isBuyer: boolean;
  onRefetch: () => void;
  publicClient: ReturnType<typeof usePublicClient>;
  walletClient: ReturnType<typeof useWalletClient>["data"];
}) {
  const [code, setCode] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  async function openEnvelope() {
    if (!order || !publicClient || !walletClient) return;
    try {
      setOpening(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = await ensureCofheConnected(publicClient as any, walletClient as any);

      toast.message("Decrypting AES key");
      let aesKeyValue: bigint | null = null;
      for (let i = 0; i < 10; i++) {
        try {
          const result = await client
            .decryptForView(order.encAesKey, FheTypes.Uint128)
            .withPermit()
            .execute();
          if (result !== undefined && result !== null) {
            aesKeyValue = result as bigint;
            break;
          }
        } catch {
          // still processing — retry
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
      if (aesKeyValue === null) throw new Error("FHE decryption still pending — try again in a bit");

      toast.message("Fetching ciphertext");
      const cid = order.ipfsCid;
      const gatewayBase = process.env.NEXT_PUBLIC_PINATA_GATEWAY ?? "gateway.pinata.cloud";
      const gw = gatewayBase.startsWith("http") ? gatewayBase : `https://${gatewayBase}`;
      const res = await fetch(`${gw.replace(/\/$/, "")}/ipfs/${cid}`);
      if (!res.ok) throw new Error("IPFS fetch failed");
      const payload = (await res.json()) as { iv: string; ciphertext: string; tag: string };

      const hex = aesKeyValue.toString(16).padStart(32, "0");
      const keyBytes = Uint8Array.from(hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        keyBytes,
        { name: "AES-GCM" },
        false,
        ["decrypt"],
      );
      const ivBytes = Uint8Array.from(payload.iv.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
      const ctBytes = Uint8Array.from(payload.ciphertext.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
      const tagBytes = Uint8Array.from(payload.tag.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
      const full = new Uint8Array(ctBytes.length + tagBytes.length);
      full.set(ctBytes, 0);
      full.set(tagBytes, ctBytes.length);
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: ivBytes },
        cryptoKey,
        full,
      );
      setCode(new TextDecoder().decode(plain));
      onRefetch();
      toast.success("Sealed open");
    } catch (err) {
      toast.error(err instanceof Error ? err.message.slice(0, 120) : "Open failed");
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/6 overflow-hidden">
      <div className="px-5 h-9 flex items-center border-b border-white/4">
        <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground/50">
          Envelope
        </p>
      </div>
      <div className="p-6 min-h-[280px] flex flex-col justify-between">
        <AnimatePresence mode="wait" initial={false}>
          {status !== "Fulfilled" ? (
            <Sealed key="sealed" status={status} />
          ) : !code ? (
            <ReadyToOpen key="ready" isBuyer={isBuyer} opening={opening} onOpen={openEnvelope} />
          ) : (
            <Revealed key="revealed" code={code} />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Sealed({ status }: { status: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, ease: EASE_OUT }}
      className="space-y-4"
    >
      <p className="text-[14px] font-medium">
        {status === "Pending" ? "Relay is fulfilling the order" : status}
      </p>
      <p className="text-[13px] text-muted-foreground/60 leading-relaxed max-w-md">
        The observer is buying the card and sealing the code right now. You'll
        be able to open the envelope on this page as soon as they're done.
      </p>
      <div className="mt-6">
        <Dots />
      </div>
    </motion.div>
  );
}

function Dots() {
  return (
    <span className="font-mono text-[14px] tracking-[0.35em] text-muted-foreground/20 select-none">
      ●●●●●●●●●●●●●●
    </span>
  );
}

function ReadyToOpen({
  isBuyer,
  opening,
  onOpen,
}: {
  isBuyer: boolean;
  opening: boolean;
  onOpen: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, ease: EASE_OUT }}
      className="space-y-5"
    >
      <p className="text-[14px] font-medium">Your code has arrived, still sealed.</p>
      <p className="text-[13px] text-muted-foreground/60 leading-relaxed max-w-md">
        Click open — your browser unseals the AES key via FHE, fetches the
        ciphertext from IPFS, and decrypts locally.
      </p>
      <Dots />
      <div className="flex items-center gap-3 pt-2">
        <motion.button
          onClick={onOpen}
          disabled={opening || !isBuyer}
          whileTap={opening || !isBuyer ? {} : { scale: 0.97 }}
          transition={{ duration: 0.12 }}
          className="h-9 px-4 text-[13px] font-medium bg-sp text-[#050505] hover:bg-sp/90 transition-colors rounded-full inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <AnimatePresence mode="wait" initial={false}>
            {opening ? (
              <motion.span
                key="o"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="inline-flex items-center gap-2"
              >
                <Spinner size={12} className="text-[#050505]" />
                Unsealing
              </motion.span>
            ) : (
              <motion.span
                key="i"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="inline-flex items-center gap-2"
              >
                <Lock className="size-3.5" strokeWidth={2.5} />
                Open envelope
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>
        {!isBuyer && (
          <p className="text-[11.5px] text-muted-foreground/50">
            Only the buyer wallet can open this envelope
          </p>
        )}
      </div>
    </motion.div>
  );
}

function Revealed({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <motion.div
      initial={{ opacity: 0, filter: "blur(10px)", y: 6 }}
      animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
      transition={{ duration: 0.7, ease: EASE_OUT }}
      className="space-y-5 relative"
    >
      <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-cyan/80">
        Your code · keep it safe
      </p>
      <div className="relative">
        <motion.pre
          layoutId="code"
          className="font-mono text-[22px] sm:text-[26px] tracking-[0.08em] text-foreground leading-tight whitespace-pre-wrap break-all select-all"
        >
          {code}
        </motion.pre>
        <motion.div
          initial={{ scaleX: 1 }}
          animate={{ scaleX: 0 }}
          transition={{ duration: 0.7, delay: 0.2, ease: EASE_OUT }}
          style={{ transformOrigin: "right" }}
          className="absolute inset-0 bg-background pointer-events-none"
        />
      </div>
      <motion.button
        onClick={copy}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.9, duration: 0.3 }}
        whileTap={{ scale: 0.97 }}
        className="h-8 px-3 text-[12px] font-medium border border-white/10 hover:bg-white/5 rounded-full transition-colors inline-flex items-center gap-2"
      >
        <AnimatePresence mode="wait" initial={false}>
          {copied ? (
            <motion.span
              key="c"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              className="inline-flex items-center gap-1.5"
            >
              <Check className="size-3.5" strokeWidth={2.5} /> Copied
            </motion.span>
          ) : (
            <motion.span
              key="i"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              className="inline-flex items-center gap-1.5"
            >
              <Copy className="size-3.5" /> Copy
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    </motion.div>
  );
}

// ───── Metadata ──────────────────────────────────────────────

function Metadata({
  order,
}: {
  order:
    | {
        buyer: `0x${string}`;
        observer: `0x${string}`;
        encProductId: bigint;
        encPaid: bigint;
        ipfsCid: string;
        deadline: bigint;
      }
    | null
    | undefined;
}) {
  const deadlineDate = order ? new Date(Number(order.deadline) * 1000) : null;
  const deadline = deadlineDate
    ? `${deadlineDate.getUTCMonth() + 1}/${deadlineDate.getUTCDate()} ${deadlineDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : "—";
  const sameParty =
    !!order && order.buyer.toLowerCase() === order.observer.toLowerCase();

  return (
    <div className="rounded-2xl border border-white/6">
      <div className="px-5 h-9 flex items-center justify-between border-b border-white/4">
        <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground/50">
          Metadata
        </p>
        <p className="text-[11px] text-muted-foreground/45 tabular-nums">{deadline}</p>
      </div>

      {/* Parties */}
      <div className="px-5 py-3 flex items-center justify-between gap-6 border-b border-white/4">
        <Party label="Buyer" address={order?.buyer} />
        {sameParty ? (
          <span className="text-[10.5px] text-muted-foreground/40 uppercase tracking-[0.08em]">
            self-fulfilled
          </span>
        ) : (
          <Party label="Observer" address={order?.observer} alignRight />
        )}
      </div>

      {/* Compact 2-col grid for handles + IPFS */}
      <div className="grid grid-cols-2 divide-x divide-white/4">
        <Cell label="Product" value={shortHandle(order?.encProductId, 5)} />
        <Cell label="Payment" value={shortHandle(order?.encPaid, 5)} />
      </div>
      <div className="px-5 py-3 border-t border-white/4 flex items-center justify-between gap-6">
        <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground/45">
          IPFS
        </p>
        {order?.ipfsCid ? (
          <a
            href={`https://gateway.pinata.cloud/ipfs/${order.ipfsCid}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 font-mono text-[12px] text-muted-foreground/75 hover:text-foreground transition-colors"
          >
            {order.ipfsCid.slice(0, 6)}…{order.ipfsCid.slice(-4)}
            <ExternalLink className="size-3 opacity-50" />
          </a>
        ) : (
          <span className="font-mono text-[12px] text-muted-foreground/40">—</span>
        )}
      </div>
    </div>
  );
}

function Party({
  label,
  address,
  alignRight,
}: {
  label: string;
  address?: string;
  alignRight?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${alignRight ? "items-end" : "items-start"}`}>
      <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground/45">
        {label}
      </p>
      <div className="inline-flex items-center gap-1.5">
        <Identicon address={address} size={14} />
        <span className="font-mono text-[12px] text-foreground/80">
          {shortAddr(address, 4, 4)}
        </span>
      </div>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-3 flex flex-col gap-1.5 min-w-0">
      <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground/45">
        {label}
      </p>
      <p className="font-mono text-[12px] text-muted-foreground/75 truncate">{value}</p>
    </div>
  );
}
