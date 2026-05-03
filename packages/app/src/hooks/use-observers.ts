"use client";

import { useReadContract, useReadContracts } from "wagmi";

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
 * Live observer roster from Sigill's `getObserverDetail()` view, augmented
 * with each observer's `getOrderCompleted` count. We bypass the contract's
 * `sucessRate` field because its arithmetic is broken (see contracts.ts).
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
  const {
    data: rawList,
    isLoading: rosterLoading,
    error: rosterError,
    refetch: refetchRoster,
  } = useReadContract({
    address: addresses.sigill,
    abi: sigillAbi,
    functionName: "getObserverDetail",
    query: {
      enabled: !!addresses.sigill,
      refetchInterval: 15_000,
      staleTime: 5_000,
    },
  });

  const list = (rawList ?? []) as readonly RawObserver[];

  const {
    data: completedList,
    isLoading: countsLoading,
    error: countsError,
    refetch: refetchCounts,
  } = useReadContracts({
    contracts: list.map((r) => ({
      address: addresses.sigill,
      abi: sigillAbi,
      functionName: "getOrderCompleted",
      args: [r.observerAddress],
    })),
    query: {
      enabled: list.length > 0 && !!addresses.sigill,
      refetchInterval: 15_000,
      staleTime: 5_000,
    },
  });

  const observers = list.map((r, i) => {
    const cell = completedList?.[i];
    const ordersCompleted =
      cell?.status === "success" ? (cell.result as bigint) : 0n;
    return toObserverEntry({
      observerAddress: r.observerAddress,
      slotLeft: r.slotLeft,
      soltSize: r.soltSize,
      ordersCompleted,
    });
  });

  return {
    observers,
    isLoading: rosterLoading || countsLoading,
    error: ((rosterError ?? countsError) as Error | null) ?? null,
    refetch: () => {
      void refetchRoster();
      void refetchCounts();
    },
  };
}
