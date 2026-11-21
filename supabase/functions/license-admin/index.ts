// DreamTeam Manager — license ADMIN Edge Function. ONLY the owner's full-edition panel calls this.
// It is guarded by an admin token (set it as a function secret, see below). The pro/basic builds
// never contain the token or this URL, so they cannot manage licenses.
//   supabase functions deploy license-admin --no-verify-jwt
//   supabase secrets set LICENSE_ADMIN_TOKEN=<a long random string>
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const SERVICE_KEY = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const db = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_KEY);
const ADMIN = Deno.env.get("LICENSE_ADMIN_TOKEN") || "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  if (!ADMIN || req.headers.get("x-admin-token") !== ADMIN) return json({ ok: false, error: "unauthorized" }, 401);

  let b: any;
  try { b = await req.json(); } catch { return json({ ok: false, error: "bad-body" }, 400); }
  const a = String(b.action || "");

  try {
    switch (a) {
      case "overview": {
        const { data: licenses } = await db.from("licenses").select("*").order("created_at", { ascending: false });
        const { data: machines } = await db.from("machines").select("*").order("last_seen", { ascending: false });
        return json({ ok: true, licenses: licenses || [], machines: machines || [] });
      }
      case "createLicense": {
        const row: any = { key: String(b.key).trim(), label: b.label ?? null, edition: b.edition === "pro" ? "pro" : "basic" };
        if (b.expiresAt) row.expires_at = b.expiresAt;
        if (b.maxMachines != null) row.max_machines = Number(b.maxMachines) || 1;
        if (b.requireApproval != null) row.require_approval = Boolean(b.requireApproval);
        const { error } = await db.from("licenses").insert(row);
        if (error) return json({ ok: false, error: error.message });
        return json({ ok: true });
      }
      case "updateLicense": {
        const patch: any = {};
        for (const f of ["label", "edition", "revoked", "max_machines", "require_approval", "expires_at"])
          if (b[f] !== undefined) patch[f] = b[f];
        const { error } = await db.from("licenses").update(patch).eq("key", b.key);
        return error ? json({ ok: false, error: error.message }) : json({ ok: true });
      }
      case "deleteLicense":
        await db.from("licenses").delete().eq("key", b.key);
        return json({ ok: true });
      case "machine": { // block / approve / label a machine, or delete it
        if (b.delete) { await db.from("machines").delete().eq("id", b.id); return json({ ok: true }); }
        const patch: any = {};
        for (const f of ["blocked", "approved", "label"]) if (b[f] !== undefined) patch[f] = b[f];
        const { error } = await db.from("machines").update(patch).eq("id", b.id);
        return error ? json({ ok: false, error: error.message }) : json({ ok: true });
      }
      default:
        return json({ ok: false, error: "unknown-action" }, 400);
    }
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
