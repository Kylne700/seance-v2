// Reused from our own 2026-10-16..18 spike (not published): walletd JSON-RPC helper.
// Minimal walletd JSON-RPC helper (auth "none" daemon on 127.0.0.1). It requests an Admin token per process.
// CLI: node scripts/wd.mjs <method> '<json params>' [maxChars]
export const WD_URL = process.env.WD_URL ?? "http://127.0.0.1:5100/json_rpc";
let id = 0, token = null;
async function raw(method, params, bearer) {
  const r = await fetch(WD_URL, {
    method: "POST",
    headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  return r.json();
}
export async function call(method, params = {}) {
  if (!token) token = (await raw("auth.request", { credentials: "None", permissions: ["Admin"] })).result.token;
  let j = await raw(method, params, token);
  if (j.error?.code === 401) { token = (await raw("auth.request", { credentials: "None", permissions: ["Admin"] })).result.token; j = await raw(method, params, token); }
  if (j.error) { const e = new Error(`${method}: ${JSON.stringify(j.error).slice(0, 700)}`); e.rpc = j.error; throw e; }
  return j.result;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , method, p = "{}", max = "1500"] = process.argv;
  try {
    const res = await call(method, JSON.parse(p));
    console.log(JSON.stringify(res, (k, v) => (typeof v === "bigint" ? v.toString() : v)).slice(0, Number(max)));
  } catch (e) { console.log("ERR", e.message); process.exitCode = 1; }
}
