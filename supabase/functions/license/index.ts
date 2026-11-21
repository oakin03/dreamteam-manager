// DreamTeam Manager — license Edge Function (the shipped app calls this).
// Deploy:  supabase functions deploy license --no-verify-jwt
// Uses the SERVICE ROLE key (an env var Supabase gives functions), so the shipped app (anon key)
// cannot touch the tables. All real decisions live here.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const SERVICE_KEY = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const db = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, reason: "method" }, 405);

  let b: any;
  try { b = await req.json(); } catch { return json({ ok: false, reason: "bad-body" }, 400); }
  const action = String(b.action || "validate");
  const key = String(b.key || "").trim();
  const machine = String(b.machine || "").trim();
  const edition = String(b.edition || "").trim();
  if (!key || !machine) return json({ ok: false, reason: "bad-body" }, 400);

  const { data: lic } = await db.from("licenses").select("*").eq("key", key).maybeSingle();
  if (!lic) return json({ ok: false, reason: "not-found" });
  if (lic.revoked) return json({ ok: false, reason: "revoked" });
  if (lic.expires_at && new Date(lic.expires_at).getTime() < Date.now())
    return json({ ok: false, reason: "expired", expiresAt: lic.expires_at });
  // a key made for one edition must not run another edition's build (basic key on a pro build, …)
  if (edition && lic.edition && edition !== lic.edition)
    return json({ ok: false, reason: "edition" });

  const { data: machines } = await db.from("machines").select("*").eq("key", key);
  const list = machines || [];
  const mine = list.find((m) => m.machine === machine);
  const patch = {
    edition: edition || null,
    user_ids: Array.isArray(b.userIds) ? b.userIds.slice(0, 500) : [],
    app_version: String(b.version || "").slice(0, 40),
    last_seen: new Date().toISOString(),
  };

  if (mine) {
    if (mine.blocked) return json({ ok: false, reason: "blocked" });
    if (lic.require_approval && !mine.approved) return json({ ok: false, reason: "pending" });
    await db.from("machines").update(patch).eq("id", mine.id);
    return json({ ok: true, reason: "ok", expiresAt: lic.expires_at });
  }

  // this machine is not bound yet
  if (action !== "activate")
    return json({ ok: false, reason: "other-machine", expiresAt: lic.expires_at });
  if (list.length >= (lic.max_machines ?? 1))
    return json({ ok: false, reason: lic.max_machines > 1 ? "machine-limit" : "other-machine" });

  const approved = !lic.require_approval;
  await db.from("machines").insert({ key, machine, approved, ...patch });
  if (!approved) return json({ ok: false, reason: "pending" });
  return json({ ok: true, reason: "ok", expiresAt: lic.expires_at });
});
