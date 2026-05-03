import { ethers } from "ethers";
import {
  createCofheConfig,
  createCofheClient,
} from "@cofhe/sdk/node";
import { Ethers6Adapter } from "@cofhe/sdk/adapters";
import { chains } from "@cofhe/sdk/chains";
import type { CofheClient, CofheConfig } from "@cofhe/sdk";

let client: CofheClient<CofheConfig> | null = null;
let connectedFor: string | null = null;
let permitFor: string | null = null;

function getClient(): CofheClient<CofheConfig> {
  if (!client) {
    const config = createCofheConfig({
      supportedChains: [chains.baseSepolia],
    });
    client = createCofheClient(config);
  }
  return client;
}

/**
 * Connects the cofhe client to this signer (idempotent per address) and
 * ensures a self-permit exists so `decryptForView().withPermit()` resolves.
 */
export async function ensureCofheInit(
  signer: ethers.Wallet,
): Promise<CofheClient<CofheConfig>> {
  const address = await signer.getAddress();
  const c = getClient();

  if (connectedFor !== address) {
    if (!signer.provider) throw new Error("signer missing provider");
    const { publicClient, walletClient } = await Ethers6Adapter(
      signer.provider,
      signer,
    );
    await c.connect(publicClient, walletClient);
    connectedFor = address;
  }
  if (permitFor !== address) {
    await c.permits.getOrCreateSelfPermit();
    permitFor = address;
  }
  return c;
}
