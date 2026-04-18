import { NextRequest, NextResponse } from "next/server";

const UPSTREAM =
  process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";

// Allow only the JSON-RPC verbs an app actually uses. Everything else 400s.
// `eth_sendRawTransaction` is included — the wallet signs in the browser and
// pushes the raw tx through this endpoint.
const ALLOWED_METHODS = new Set([
  "eth_blockNumber",
  "eth_chainId",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getCode",
  "eth_getLogs",
  "eth_getStorageAt",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
  "eth_sendRawTransaction",
  "eth_subscribe",
  "eth_unsubscribe",
  "net_version",
  "web3_clientVersion",
]);

type RpcBody = { jsonrpc?: string; id?: unknown; method?: string; params?: unknown };

function isAllowed(body: unknown): boolean {
  if (Array.isArray(body)) {
    return body.every((item) => typeof item === "object" && item !== null && ALLOWED_METHODS.has((item as RpcBody).method ?? ""));
  }
  if (typeof body === "object" && body !== null) {
    return ALLOWED_METHODS.has((body as RpcBody).method ?? "");
  }
  return false;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!isAllowed(body)) {
    return NextResponse.json({ error: "method not allowed" }, { status: 403 });
  }

  const upstream = await fetch(UPSTREAM, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const json = await upstream.json();
  return NextResponse.json(json, {
    status: upstream.status,
    headers: { "Cache-Control": "no-store" },
  });
}

export const dynamic = "force-dynamic";
