import { ingestMt5Report, mt5ReportSchema } from "@/lib/brokers/mt5";
import { sha256 } from "@/lib/secrets";
import { getStore } from "@/lib/trading/store";

export const dynamic = "force-dynamic";

/**
 * Called by BinaryTradesBridge.mq5 every few seconds. Authenticated by the
 * per-account bridge key (X-Bridge-Key header) generated when you add the
 * account on the Brokers page. Responds with plain text: "OK" on the first
 * line, then one queued command per line.
 */
export async function POST(request: Request) {
  const key = request.headers.get("x-bridge-key");
  if (!key) return new Response("ERR missing bridge key", { status: 401 });

  const store = getStore();
  const hash = sha256(key.trim());
  const [account] = await store.brokers.all({ eq: { bridge_key_hash: hash, kind: "mt5" }, limit: 1 });
  if (!account) return new Response("ERR unknown bridge key", { status: 401 });

  let body: unknown;
  try {
    // MQL5 may append a NUL terminator to the request body.
    body = JSON.parse((await request.text()).replace(/\0+$/, ""));
  } catch {
    return new Response("ERR body must be JSON", { status: 400 });
  }
  const parsed = mt5ReportSchema.safeParse(body);
  if (!parsed.success) return new Response(`ERR ${parsed.error.issues[0]?.message ?? "invalid report"}`, { status: 400 });

  const commands = await ingestMt5Report(account, parsed.data);
  return new Response(`OK\n${commands}`, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
