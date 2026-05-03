"use client";

import { useReadContract } from "wagmi";

import {
  addresses,
  sigillAbi,
  toObserverEntry,
  type ObserverEntry,
} from "@/lib/contracts";

type RawObserver = {
  observerAddress: `0x${string}`;
  sucessRate: bigint;
  slotLeft: bigint;
  soltSize: bigint;
};

/**
 * Live observer roster from Sigill's `getObserverDetail()` view.
 * Returns one entry per registered observer plus the loading state.
 *
 * Refetches every 15s so the UI catches new registrations and slot churn
 * without forcing the user to refresh.
 */
export function useObservers(): {
  observers: ObserverEntry[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const { data, isLoading, error, refetch } = useReadContract({
    address: addresses.sigill,
    abi: sigillAbi,
    functionName: "getObserverDetail",
    query: {
      enabled: !!addresses.sigill,
      refetchInterval: 15_000,
      staleTime: 5_000,
    },
  });

  const observers = ((data ?? []) as readonly RawObserver[]).map((r) =>
    toObserverEntry({
      observerAddress: r.observerAddress,
      sucessRate: r.sucessRate,
      slotLeft: r.slotLeft,
      soltSize: r.soltSize,
    }),
  );

  return {
    observers,
    isLoading,
    error: (error as Error | null) ?? null,
    refetch: () => void refetch(),
  };
}
