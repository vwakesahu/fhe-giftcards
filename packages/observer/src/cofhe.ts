import { ethers } from "ethers";
import {
  cofhejs,
  type AbstractProvider,
  type AbstractSigner,
} from "cofhejs/node";

function wrapSigner(signer: ethers.Wallet | ethers.HDNodeWallet): {
  provider: AbstractProvider;
  signer: AbstractSigner;
} {
  const runnerProvider = signer.provider as ethers.JsonRpcApiProvider | null;
  if (!runnerProvider) throw new Error("signer missing provider");

  const provider: AbstractProvider = {
    call: async (tx) => runnerProvider.call(tx),
    getChainId: async () => (await runnerProvider.getNetwork()).chainId.toString(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    send: async (method: string, params?: any[]) => runnerProvider.send(method, params ?? []),
  };

  const abstractSigner: AbstractSigner = {
    signTypedData: async (domain, types, value) =>
      signer.signTypedData(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        domain as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        types as any,
        value as Record<string, unknown>,
      ),
    getAddress: async () => signer.getAddress(),
    provider,
    sendTransaction: async (tx) => {
      const sent = await signer.sendTransaction(tx);
      return sent.hash;
    },
  };

  return { provider, signer: abstractSigner };
}

let initialisedFor: string | null = null;

export async function ensureCofheInit(signer: ethers.Wallet): Promise<void> {
  const address = await signer.getAddress();
  if (initialisedFor === address) return;
  const wrapped = wrapSigner(signer);
  const result = await cofhejs.initialize({
    provider: wrapped.provider,
    signer: wrapped.signer,
    environment: "TESTNET",
  });
  if (result.error) {
    const err = result.error as { code?: string; message?: string; cause?: unknown };
    const inner = err.cause instanceof Error ? ` — ${err.cause.message}` : "";
    throw new Error(`cofhejs init failed [${err.code ?? "?"}]: ${err.message ?? "unknown"}${inner}`);
  }
  initialisedFor = address;
}
