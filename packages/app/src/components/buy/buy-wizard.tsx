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
import { Encryptable, FheTypes, assertCorrectEncryptedItemInput } from "@cofhe/sdk";

import { useObservers } from "@/hooks/use-observers";
import { ensureCofheConnected } from "@/lib/cofhe";
import { simulateAndGetGas, GAS_CEILING } from "@/lib/gas";
import { EASE_OUT, stepVariants } from "@/lib/motion";
import { ProductStep } from "./step-product";
import { ObserverStep } from "./step-observer";
import { ConfirmStep } from "./step-confirm";

type Step = 0 | 1 | 2;

const STEPS = [
  { title: "Pick card", desc: "Three Amazon denominations, sealed with FHE." },
  { title: "Pick relay", desc: "Which observer fulfils the order." },
  { title: "Confirm", desc: "Three tx — quote, approve sealed cUSDC, confirm." },
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
    if (product.comingSoon) {
      // Defensive: the picker disables coming-soon rows so this can't trigger
      // through the UI, but reject anyway in case state was poked externally.
      // The on-chain product isn't activated either, so quoteOrder would
      // revert "unknown product" — we just want a cleaner error than that.
      toast.error(`${product.label} is coming soon — not orderable yet`);
      return;
    }
    if (selectedObserver.status !== "online") {
      toast.error("Relay queue just filled up — pick another");
      return;
    }
    try {
      setPlacing(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = await ensureCofheConnected(publicClient as any, walletClient);

      // ── 1. Quote ─────────────────────────────────────────
      //      Contract computes (amount + observerFee + 0.25% platformFee)
      //      inside the encrypted domain and emits OrderQuoted with the
      //      handle. amountUsdc is the gift-card price in cUSDC base units.
      toast.message("Requesting quote");
      const quoteCall = {
        address: addresses.sigill,
        abi: sigillAbi,
        functionName: "quoteOrder" as const,
        args: [BigInt(product.id), selectedObserver.address, priceRaw] as const,
        account: walletClient.account!,
      };
      const quoteGas = await simulateAndGetGas(
        publicClient,
        quoteCall,
        GAS_CEILING.sigillQuoteOrder,
      );
      const quoteHash = await walletClient.writeContract({
        ...quoteCall,
        chain: walletClient.chain,
        gas: quoteGas,
      });
      const quoteReceipt = await publicClient.waitForTransactionReceipt({
        hash: quoteHash,
      });
      if (quoteReceipt.status !== "success") {
        throw new Error("quoteOrder reverted — product may not be active");
      }

      const quotedLog = quoteReceipt.logs
        .map((l: (typeof quoteReceipt.logs)[number]) => {
          try {
            const decoded = decodeEventLog({ abi: sigillAbi, data: l.data, topics: l.topics });
            return decoded.eventName === "OrderQuoted" ? decoded : null;
          } catch {
            return null;
          }
        })
        .find(Boolean);

      if (!quotedLog || !("pendingId" in quotedLog.args)) {
        throw new Error("Quote tx mined but no OrderQuoted event found");
      }
      const pendingId = quotedLog.args.pendingId as bigint;
      const expectedTotalHandle = quotedLog.args.expectedTotalHandle as bigint;

      // ── 2. Unseal the quoted total ───────────────────────
      //      Buyer has ACL on the handle (granted in _quoteOrder). Retry
      //      the decrypt loop because the FHE network can lag a few seconds
      //      behind the on-chain block, especially on Base Sepolia.
      toast.message("Unsealing quoted total");
      let quotedTotal: bigint | null = null;
      for (let i = 0; i < 10; i++) {
        try {
          const result = await client
            .decryptForView(expectedTotalHandle, FheTypes.Uint64)
            .withPermit()
            .execute();
          if (result !== undefined && result !== null) {
            quotedTotal = result as bigint;
            break;
          }
        } catch {
          // still processing — retry
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
      if (quotedTotal === null) {
        throw new Error("Could not unseal quoted total — try again in a moment");
      }

      // ── 2b. Pre-flight balance check ──────────────────────
      //       cUSDC._clampToBalance returns 0 (not partial) when the
      //       buyer's sealed balance is below the approved amount. So
      //       even being 1 base unit short results in transferred=0,
      //       FHE.eq mismatch in confirmOrder, escrow zeroed, observer
      //       rejects. Catch it pre-tx by unsealing the buyer's own
      //       balance handle (buyer always has ACL on their own balance)
      //       and comparing against the quoted total. Bails early with
      //       a clear "wrap more USDC" message so the buyer doesn't
      //       burn ~$0.10 of gas on an approve + confirm + refund dance.
      if (cUSDCBalanceHandle && cUSDCBalanceHandle !== 0n) {
        toast.message("Checking sealed balance");
        let sealedBal: bigint | null = null;
        for (let i = 0; i < 10; i++) {
          try {
            const result = await client
              .decryptForView(cUSDCBalanceHandle, FheTypes.Uint64)
              .withPermit()
              .execute();
            if (result !== undefined && result !== null) {
              sealedBal = result as bigint;
              break;
            }
          } catch {
            // threshold network still processing — retry
          }
          await new Promise((r) => setTimeout(r, 3000));
        }
        if (sealedBal !== null && sealedBal < quotedTotal) {
          const fmt = (v: bigint) => {
            const whole = v / 1_000_000n;
            const frac = (v % 1_000_000n).toString().padStart(6, "0").slice(0, 2).replace(/0+$/, "");
            return frac ? `${whole}.${frac}` : `${whole}`;
          };
          const need = quotedTotal - sealedBal;
          throw new Error(
            `Sealed balance is ${fmt(sealedBal)} cUSDC, need ${fmt(quotedTotal)} — wrap ${fmt(need)} more USDC first`,
          );
        }
      }

      // ── 3. Encrypted approve for exactly the quoted total ─
      //      confirmOrder uses FHE.eq to compare the pulled allowance
      //      against the stored expectedTotal; any deviance results in a
      //      silent refund (the order escrow becomes 0 and the observer
      //      rejects). So we must approve the exact unsealed amount.
      toast.message("Encrypting allowance");
      const [encApprove] = await client
        .encryptInputs([Encryptable.uint64(quotedTotal)])
        .execute();
      assertCorrectEncryptedItemInput(encApprove);

      toast.message("Approving sealed cUSDC");
      const approveCall = {
        address: addresses.cUSDC,
        abi: cUSDCAbi,
        functionName: "approve" as const,
        args: [addresses.sigill, encApprove] as const,
        account: walletClient.account!,
      };
      const approveGas = await simulateAndGetGas(
        publicClient,
        approveCall,
        GAS_CEILING.cusdcApprove,
      );
      const approveHash = await walletClient.writeContract({
        ...approveCall,
        chain: walletClient.chain,
        gas: approveGas,
      });
      const approveReceipt = await publicClient.waitForTransactionReceipt({
        hash: approveHash,
      });
      if (approveReceipt.status !== "success") {
        throw new Error("cUSDC approval reverted — try again");
      }

      // ── 4. Confirm ───────────────────────────────────────
      toast.message("Confirming order");
      const confirmCall = {
        address: addresses.sigill,
        abi: sigillAbi,
        functionName: "confirmOrder" as const,
        args: [pendingId] as const,
        account: walletClient.account!,
      };
      const confirmGas = await simulateAndGetGas(
        publicClient,
        confirmCall,
        GAS_CEILING.sigillConfirmOrder,
      );
      const confirmHash = await walletClient.writeContract({
        ...confirmCall,
        chain: walletClient.chain,
        gas: confirmGas,
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: confirmHash,
      });
      if (receipt.status !== "success") {
        throw new Error("confirmOrder reverted — sealed balance may be insufficient");
      }

      // confirmOrder emits one of two events depending on the relay's
      // slot capacity at confirm time: OrderInProccessed (sic, kept to
      // match the on-chain typo) or OrderInQueued. Both carry orderId.
      const log = receipt.logs
        .map((l: (typeof receipt.logs)[number]) => {
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
      if (orderId === undefined) throw new Error("Order confirmed but no OrderInProccessed/OrderInQueued event found");

      const queued = log?.eventName === "OrderInQueued";
      toast.success(queued ? `Order #${String(orderId)} queued` : `Order #${String(orderId)} sealed`);
      router.push(`/order/${orderId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const friendly = /Observers queue is full/i.test(msg)
        ? "Relay queue is full — pick another relay"
        : /Observer not bonded/i.test(msg)
          ? "This relay is no longer bonded — pick another"
          : /unknown product/i.test(msg)
            ? "Product isn't active in the catalogue yet — admin must enable it"
            : /Quote expired/i.test(msg)
              ? "Quote expired before confirm — start over"
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
        className="h-9 px-4 text-[13px] font-medium bg-sp text-[#0d0c0a] hover:bg-sp/90 transition-colors rounded-full disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
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
