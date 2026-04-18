import dotenv from "dotenv";

// Next.js-style: .env.local (gitignored, real values) takes precedence over .env.
dotenv.config({ path: ".env.local" });
dotenv.config();

function req(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`${key} env var required — copy .env.example to .env and fill it in`);
  return v;
}

function opt(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const config = {
  privateKey: req("OBSERVER_PRIVATE_KEY"),
  rpcUrl: req("BASE_SEPOLIA_RPC_URL"),
  sigillAddress: req("SIGILL_ADDRESS") as `0x${string}`,
  cUSDCAddress: req("CUSDC_ADDRESS") as `0x${string}`,
  pollIntervalMs: Number(opt("POLL_INTERVAL_MS", "10000")),
  explorer: "https://sepolia.basescan.org",
} as const;
