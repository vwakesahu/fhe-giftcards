import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  metaMaskWallet,
  rainbowWallet,
  coinbaseWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { baseSepolia } from "wagmi/chains";

// In the browser we go through our own /api/rpc proxy — the real
// provider URL is a server-only secret. On the server (SSR) we call
// upstream directly since there's no relative URL to speak of.
const rpcUrl =
  typeof window === "undefined"
    ? process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org"
    : "/api/rpc";

const connectors = connectorsForWallets(
  [
    {
      groupName: "Wallets",
      wallets: [injectedWallet, metaMaskWallet, rainbowWallet, coinbaseWallet],
    },
  ],
  {
    appName: "Sigill",
    projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "sigill-dev",
  },
);

export const wagmiConfig = createConfig({
  connectors,
  chains: [baseSepolia],
  transports: {
    [baseSepolia.id]: http(rpcUrl, { batch: true }),
  },
  ssr: true,
});
