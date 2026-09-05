// =====================================================================
// /auth — вход через Telegram и финансовый замок
//
//   POST /auth            { initData }              -> сессия + JWT
//   POST /auth/unlock     { pin }        (Bearer)   -> JWT с claim'ом fin_exp
//   POST /auth/set-pin    { pin, current_pin? }     -> установка/смена PIN
// =====================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { BOT_TOKEN, JWT_SECRET, SERVICE_KEY, SUPABASE_URL, CORS, json } from "../_shared/env.ts";
import { verifyInitData } from "../_shared/telegram.ts";
import { hashPin, issueToken, readToken, verifyPin } from "../_shared/jwt.ts";

const db = () => createClient(SUPABASE_URL(), SERVICE_KEY(), { auth: { persistSession: false } });

async function currentStaff(req: Request) {
  const raw = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!raw) throw new Error("Нет токена");
  const claims = await readToken(raw, JWT_SECRET());
  const { data } = await db().from("staff").select("*").eq("id", claims.staff_id).single();
  if (!data || !data.is_active || data.archived_at) throw new Error("Доступ отозван");
  return data;
}

async function audit(actor: string | null, action: string, diff: unknown = null) {
  await db().from("audit_log").insert({
    actor_staff_id: actor, action, target_table: "staff", target_id: actor, diff,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const route = new URL(req.url).pathname.split("/").filter(Boolean).pop();

  try {
    // ---------------- Вход: initData -> JWT ----------------------------
    if (route === "auth") {
      const { initData } = await req.json();
      const tgUser = await verifyInitData(initData, BOT_TOKEN());

      const { data: staff } = await db()
        .from("staff").select("*").eq("telegram_id", tgUser.id).maybeSingle();

      // Незнакомый telegram_id — это не ошибка приложения, а отсутствие доступа.
      // Сотрудников заводит root-админ, самозаписи нет by design.
      if (!staff || !staff.is_active || staff.archived_at) {
        return json({ error: "no_access", message: "Доступ не выдан. Обратитесь к администратору." }, 403);
      }

      await db().from("staff").update({ last_seen_at: new Date().toISOString() }).eq("id", staff.id);

      const { data: settings } = await db().from("app_settings").select("*").eq("id", 1).single();

      return json({
        token: await issueToken({ staff_id: staff.id, app_role: staff.role }, JWT_SECRET()),
        staff: {
          id: staff.id, full_name: staff.full_name, role: staff.role,
          phone: staff.phone, has_finance_pin: !!staff.finance_pin_hash,
        },
        settings,
      });
    }

    // ---------------- Разблокировка финансов ---------------------------
    if (route === "unlock") {
      const staff = await currentStaff(req);
      const { pin } = await req.json();

      if (staff.role !== "root_admin") return json({ error: "forbidden" }, 403);
      if (!staff.finance_pin_hash) return json({ error: "pin_not_set" }, 409);

      const { data: cfg } = await db().from("app_settings").select("*").eq("id", 1).single();

      if (staff.finance_locked_until && new Date(staff.finance_locked_until) > new Date()) {
        return json({ error: "locked", until: staff.finance_locked_until }, 429);
      }

      if (!(await verifyPin(String(pin), staff.finance_pin_hash))) {
        const attempts = staff.finance_failed_attempts + 1;
        const lock = attempts >= cfg.finance_max_attempts;
        await db().from("staff").update({
          finance_failed_attempts: lock ? 0 : attempts,
          finance_locked_until: lock
            ? new Date(Date.now() + cfg.finance_lockout_minutes * 60_000).toISOString()
            : null,
        }).eq("id", staff.id);

        await audit(staff.id, "finance.unlock_failed", { attempts });
        // при блокировке бот отдельно шлёт уведомление владельцу
        return json({ error: "bad_pin", attempts_left: Math.max(0, cfg.finance_max_attempts - attempts) }, 401);
      }

      await db().from("staff")
        .update({ finance_failed_attempts: 0, finance_locked_until: null })
        .eq("id", staff.id);
      await audit(staff.id, "finance.unlock", null);

      const finExp = Math.floor(Date.now() / 1000) + cfg.finance_session_minutes * 60;
      return json({
        token: await issueToken(
          { staff_id: staff.id, app_role: staff.role, fin_exp: finExp },
          JWT_SECRET(),
          cfg.finance_session_minutes * 60,
        ),
        fin_exp: finExp,
        idle_lock_seconds: cfg.finance_idle_lock_seconds,
      });
    }

    // ---------------- Установка / смена PIN ----------------------------
    if (route === "set-pin") {
      const staff = await currentStaff(req);
      const { pin, current_pin } = await req.json();

      if (staff.role !== "root_admin") return json({ error: "forbidden" }, 403);
      if (!/^\d{6}$/.test(String(pin))) return json({ error: "pin_format", message: "PIN — 6 цифр" }, 400);

      if (staff.finance_pin_hash && !(await verifyPin(String(current_pin ?? ""), staff.finance_pin_hash))) {
        return json({ error: "bad_pin" }, 401);
      }

      await db().from("staff")
        .update({ finance_pin_hash: await hashPin(String(pin)), finance_failed_attempts: 0, finance_locked_until: null })
        .eq("id", staff.id);
      await audit(staff.id, "finance.pin_changed", null);

      return json({ ok: true });
    }

    return json({ error: "not_found" }, 404);
  } catch (e) {
    return json({ error: "bad_request", message: String((e as Error).message) }, 400);
  }
});
