"use client";

/**
 * cofhejs helper — the real SDK is big (FHE keys + WASM) so we import it
 * lazily on first use. Pages that never touch FHE stay lean.
 */
import type {
  AbstractProvider,
  AbstractSigner,
} from "cofhejs/web";
import type { PublicClient, WalletClient } from "viem";

type CofhejsNs = typeof import("cofhejs/web");

let lazy: Promise<CofhejsNs> | null = null;
function loadCofhejs(): Promise<CofhejsNs> {
  if (!lazy) lazy = import("cofhejs/web");
  return lazy;
}

function wrap(publicClient: PublicClient, walletClient: WalletClient): {
  provider: AbstractProvider;
  signer: AbstractSigner;
} {
  const provider: AbstractProvider = {
    call: async ({ to, data }) => {
      const result = await publicClient.call({
        to: to as `0x${string}`,
        data: data as `0x${string}`,
      });
      return result.data ?? "0x";
    },
    getChainId: async () => String(await publicClient.getChainId()),
    send: async (method: string, params?: unknown[]) =>
      publicClient.request({
        method: method as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        params: params as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      }) as unknown as Promise<unknown>,
  };

  const signer: AbstractSigner = {
    signTypedData: async (domain, types, value) =>
      walletClient.signTypedData({
        account: walletClient.account!,
        domain: domain as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        types: types as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        primaryType: Object.keys(types)[0] ?? "",
        message: value as Record<string, unknown>,
      }),
    getAddress: async () => walletClient.account!.address,
    provider,
    sendTransaction: async (tx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const loose = tx as any;
      const hash = await walletClient.sendTransaction({
        account: walletClient.account!,
        to: loose.to as `0x${string}`,
        data: loose.data as `0x${string}` | undefined,
        value: loose.value ? BigInt(String(loose.value)) : undefined,
        chain: null,
      });
      return hash;
    },
  };

  return { provider, signer };
}

let initializedFor: string | null = null;

/** Initialise cofhejs for this wallet (no-op if already done for this address). */
export async function ensureCofheInit(
  publicClient: PublicClient,
  walletClient: WalletClient,
) {
  const address = walletClient.account?.address;
  if (!address) throw new Error("wallet not connected");
  if (initializedFor === address) return;

  const { cofhejs } = await loadCofhejs();
  const { provider, signer } = wrap(publicClient, walletClient);
  const result = await cofhejs.initialize({
    provider,
    signer,
    environment: "TESTNET",
  });
  if (result.error) {
    // cofhejs swallows the real cause behind a generic "An internal error
    // occurred" — drill into `cause` so the toast shows something useful.
    const err = result.error as { code?: string; message?: string; cause?: unknown };
    const inner = err.cause instanceof Error ? ` — ${err.cause.message}` : "";
    console.error("[cofhejs init error]", err);
    throw new Error(`cofhejs init failed [${err.code ?? "?"}]: ${err.message ?? "unknown"}${inner}`);
  }
  initializedFor = address;
}

/** Expose the lazy namespace so callers can cofhejs.encrypt/unseal/etc. */
export async function getCofhejs(): Promise<CofhejsNs> {
  return loadCofhejs();
}
