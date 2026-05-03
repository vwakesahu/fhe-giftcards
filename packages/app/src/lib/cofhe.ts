"use client";

/**
 * @cofhe/sdk helper. The SDK defers the TFHE WASM load to the first
 * `encryptInputs(...)` call, so importing this module at the page entry is
 * cheap. We keep a singleton client so connect/permit setup happens once per
 * wallet address.
 */
import { createCofheConfig, createCofheClient } from "@cofhe/sdk/web";
import { chains } from "@cofhe/sdk/chains";
import type { CofheClient, CofheConfig } from "@cofhe/sdk";
import type { PublicClient, WalletClient } from "viem";

let client: CofheClient<CofheConfig> | null = null;
let connectedFor: string | null = null;
let permitFor: string | null = null;

export function getCofheClient(): CofheClient<CofheConfig> {
  if (!client) {
    const config = createCofheConfig({
      supportedChains: [chains.baseSepolia],
    });
    client = createCofheClient(config);
  }
  return client;
}

/**
 * Connects the singleton client to the wallet and ensures a self-permit
 * exists for this (chainId, account). Idempotent per address — repeated
 * calls for the same wallet are no-ops.
 */
export async function ensureCofheConnected(
  publicClient: PublicClient,
  walletClient: WalletClient,
): Promise<CofheClient<CofheConfig>> {
  const address = walletClient.account?.address;
  if (!address) throw new Error("wallet not connected");

  const c = getCofheClient();
  if (connectedFor !== address) {
    await c.connect(publicClient, walletClient);
    connectedFor = address;
  }
  if (permitFor !== address) {
    // decryptForView().withPermit() needs an active self-permit; this prompts
    // a wallet signature on first call and is cached for future calls.
    await c.permits.getOrCreateSelfPermit();
    permitFor = address;
  }
  return c;
}
