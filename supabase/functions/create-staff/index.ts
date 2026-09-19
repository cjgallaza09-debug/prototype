import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) throw new Error("Missing admin session.");

    const userClient = createClient(supabaseUrl, serviceRole, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !user) throw new Error("Invalid session.");

    const { data: adminProfile, error: profileError } = await userClient
      .from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (profileError || adminProfile?.role !== "admin") throw new Error("Admin access required.");

    const body = await req.json();
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error("Invalid username.");
    if (password.length < 6) throw new Error("Password must be at least 6 characters.");

    const { data: existing } = await userClient.from("profiles").select("id").eq("username", username).maybeSingle();
    if (existing) throw new Error("That username is already in use.");

    // Internal-only synthetic email. Staff never sees or enters this value.
    const internalEmail = `${username}@staff.cashregisterx.local`;
    const { data: created, error: createError } = await userClient.auth.admin.createUser({
      email: internalEmail, password, email_confirm: true,
      user_metadata: { username, role: "staff" },
    });
    if (createError || !created.user) throw new Error(createError?.message || "Could not create Auth user.");

    const { error: insertError } = await userClient.from("profiles").insert({
      id: created.user.id, email: internalEmail, username, full_name: username, role: "staff"
    });
    if (insertError) {
      await userClient.auth.admin.deleteUser(created.user.id);
      throw new Error(insertError.message);
    }

    return new Response(JSON.stringify({ ok: true, username }), {
      status: 200, headers: { ...cors, "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Request failed." }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" }
    });
  }
});
