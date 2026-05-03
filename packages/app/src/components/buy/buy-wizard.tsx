"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useReadContract, usePublicClient, useWalletClient } from "wagmi";
import { decodeEventLog } from "viem";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight } from "lucide-react";

import {
  addresses,
  cUSDCAbi,
  sigillAbi,
  type Product,
} from "@/lib/contracts";
import { Encryptable, assertCorrectEncryptedItemInput } from "@cofhe/sdk";

import { useObservers } from "@/hooks/use-observers";
import { ensureCofheConnected } from "@/lib/cofhe";
import { EASE_OUT, stepVariants } from "@/lib/motion";
import { ProductStep } from "./step-product";
import { ObserverStep } from "./step-observer";
import { ConfirmStep } from "./step-confirm";

type Step = 0 | 1 | 2;

const STEPS = [
  { title: "Pick card", desc: "Three Amazon denominations, sealed with FHE." },
  { title: "Pick relay", desc: "Which observer fulfils the order." },
  { title: "Confirm", desc: "Two tx — approve an encrypted allowance, place order." },
] as const;

export function BuyWizard() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [step, setStep] = useState<Step>(0);
  const [dir, setDir] = useState(1);
  const [product, setProduct] = useState<Product | null>(null);
  const [observerId, setObserverId] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);

  const { observers } = useObservers();
  const selectedObserver = observers.find((o) => o.id === observerId) ?? null;
  const priceRaw = useMemo(
    () => (product ? BigInt(product.priceUsdc) * 1_000_000n : 0n),
    [product],
  );

  const { data: cUSDCBalanceHandle } = useReadContract({
    address: addresses.cUSDC,
    abi: cUSDCAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const hasSealedBalance = (cUSDCBalanceHandle ?? 0n) > 0n;

  function go(delta: number) {
    setDir(delta);
    setStep((s) => Math.max(0, Math.min(2, s + delta)) as Step);
  }

  async function handlePlace() {
    if (!product || !selectedObserver || !publicClient || !walletClient) return;
    if (selectedObserver.status !== "online") {
      toast.error("Relay queue just filled up — pick another");
      return;
    }
    try {
      setPlacing(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = await ensureCofheConnected(publicClient as any, walletClient);

      toast.message("Encrypting inputs");
      const [encProductId, encAmount] = await client
        .encryptInputs([
          Encryptable.uint64(BigInt(product.id)),
          Encryptable.uint64(priceRaw),
        ])
        .execute();
      assertCorrectEncryptedItemInput(encProductId);
      assertCorrectEncryptedItemInput(encAmount);

      toast.message("Approving cUSDC allowance");
      const approveHash = await walletClient.writeContract({
        address: addresses.cUSDC,
        abi: cUSDCAbi,
        functionName: "approve",
        args: [addresses.sigill, encAmount],
        account: walletClient.account!,
        chain: walletClient.chain,
      });
      const approveReceipt = await publicClient.waitForTransactionReceipt({
        hash: approveHash,
      });
      if (approveReceipt.status !== "success") {
        throw new Error("cUSDC approval reverted — try again");
      }

      toast.message("Placing order");
      const placeHash = await walletClient.writeContract({
        address: addresses.sigill,
        abi: sigillAbi,
        functionName: "placeOrder",
        args: [encProductId, selectedObserver.address],
        account: walletClient.account!,
        chain: walletClient.chain,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: placeHash });
      if (receipt.status !== "success") {
        throw new Error("placeOrder reverted — sealed balance may be insufficient");
      }

      // Sigill emits one of two events on placeOrder: OrderInProccessed (sic
      // — typo on-chain) when the relay had a free slot, or OrderInQueued
      // when the buyer is waitlisted. Both carry `orderId` first.
      const log = receipt.logs
        .map((l) => {
          try {
            const decoded = decodeEventLog({ abi: sigillAbi, data: l.data, topics: l.topics });
            return decoded.eventName === "OrderInProccessed" ||
              decoded.eventName === "OrderInQueued"
              ? decoded
              : null;
          } catch {
            return null;
          }
        })
        .find(Boolean);

      const orderId = log?.args && "orderId" in log.args ? (log.args.orderId as bigint) : undefined;
      if (orderId === undefined) throw new Error("Order placed but no OrderInProccessed/OrderInQueued event found");

      const queued = log?.eventName === "OrderInQueued";
      toast.success(queued ? `Order #${String(orderId)} queued` : `Order #${String(orderId)} sealed`);
      router.push(`/order/${orderId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const friendly = /Observers queue is full/i.test(msg)
        ? "Relay queue is full — pick another relay"
        : /Observer not bonded/i.test(msg)
          ? "This relay is no longer bonded — pick another"
          : msg.slice(0, 140);
      toast.error(friendly);
      setPlacing(false);
    }
  }

  const canAdvance = {
    0: !!product,
    1: !!selectedObserver && selectedObserver.status === "online",
    2: false,
  }[step];

  const current = STEPS[step];

  return (
    <>
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE_OUT }}
        className="flex items-center justify-between gap-6 flex-wrap"
      >
        <div>
          <h1 className="text-[20px] font-semibold tracking-[-0.01em]">New order</h1>
          <p className="mt-1 text-[13px] text-muted-foreground/75 leading-relaxed">
            Three quick steps. Amounts stay encrypted end-to-end.
          </p>
        </div>
        <StepPills step={step} />
      </motion.div>

      {/* Step title + description */}
      <div className="mt-8 pb-4 border-b border-white/[0.06]">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -2 }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
          >
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-sp/80">
              Step {String(step + 1).padStart(2, "0")} · {current.title}
            </p>
            <p className="mt-1.5 text-[13px] text-muted-foreground/65 leading-relaxed">
              {current.desc}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Step body */}
      <div className="relative mt-8 min-h-[380px] overflow-hidden">
        <AnimatePresence custom={dir} mode="wait" initial={false}>
          <motion.div
            key={step}
            custom={dir}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
          >
            {step === 0 && (
              <ProductStep
                selectedId={product?.id ?? null}
                onSelect={(p) => {
                  setProduct(p);
                  go(1);
                }}
              />
            )}
            {step === 1 && (
              <ObserverStep
                selectedId={observerId}
                onSelect={(id) => {
                  setObserverId(id);
                  go(1);
                }}
              />
            )}
            {step === 2 && product && selectedObserver && (
              <ConfirmStep
                product={product}
                observer={selectedObserver}
                placing={placing}
                hasSealedBalance={hasSealedBalance}
                onPlace={handlePlace}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer */}
      <Footer
        step={step}
        canAdvance={!!canAdvance}
        canBack={step > 0 && !placing}
        isConnected={isConnected}
        onBack={() => go(-1)}
        onNext={() => go(1)}
      />
    </>
  );
}

function StepPills({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: 3 }).map((_, i) => (
        <motion.span
          key={i}
          animate={{
            width: i === step ? 20 : 6,
            backgroundColor: i <= step ? "var(--sp)" : "rgba(255,255,255,0.12)",
          }}
          transition={{ duration: 0.35, ease: EASE_OUT }}
          className="h-[3px] rounded-full"
        />
      ))}
    </div>
  );
}

function Footer({
  step,
  canAdvance,
  canBack,
  isConnected,
  onBack,
  onNext,
}: {
  step: number;
  canAdvance: boolean;
  canBack: boolean;
  isConnected: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  if (!isConnected) {
    return (
      <div className="mt-10 h-10 rounded-full border border-white/[0.06] text-[12px] text-muted-foreground/60 flex items-center justify-center">
        Connect a wallet to continue
      </div>
    );
  }
  if (step === 0 || step === 2) {
    return (
      <div className="mt-10 flex justify-start">
        <BackButton disabled={!canBack} onClick={onBack} />
      </div>
    );
  }
  return (
    <div className="mt-10 flex items-center justify-between">
      <BackButton disabled={!canBack} onClick={onBack} />
      <motion.button
        onClick={onNext}
        disabled={!canAdvance}
        whileTap={canAdvance ? { scale: 0.97 } : {}}
        transition={{ duration: 0.12 }}
        className="h-9 px-4 text-[13px] font-medium bg-sp text-[#050505] hover:bg-sp/90 transition-colors rounded-full disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
      >
        Continue
        <ArrowRight className="size-3.5" />
      </motion.button>
    </div>
  );
}

function BackButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="h-8 px-2 inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground/65 hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
    >
      <ArrowLeft className="size-3.5" />
      Back
    </button>
  );
}
