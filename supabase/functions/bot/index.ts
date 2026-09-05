// =====================================================================
// Telegram-бот: вход по номеру телефона, меню, заявки на закуп,
// уведомления из БД.
//
//   POST /bot           — webhook Telegram
//   POST /bot/notify    — уведомления (Database Webhooks), заголовок x-webhook-secret
// =====================================================================

import { Bot, InlineKeyboard, Keyboard, webhookCallback } from "npm:grammy@1";
import { createClient } from "npm:@supabase/supabase-js@2";
import { BOT_TOKEN, MINIAPP_URL, SERVICE_KEY, SUPABASE_URL, WEBHOOK_SECRET, json } from "../_shared/env.ts";
import { normalizePhone } from "../_shared/telegram.ts";

const db = createClient(SUPABASE_URL(), SERVICE_KEY(), { auth: { persistSession: false } });
const bot = new Bot(BOT_TOKEN());
const app = MINIAPP_URL();

const uzs = (n: number) => new Intl.NumberFormat("ru-RU").format(n) + " сум";

// ---------- Сессии диалога ---------------------------------------------

async function getState(tgId: number) {
  const { data } = await db.from("bot_sessions").select("state").eq("telegram_id", tgId).maybeSingle();
  return (data?.state ?? {}) as Record<string, unknown>;
}
async function setState(tgId: number, state: Record<string, unknown>) {
  await db.from("bot_sessions")
    .upsert({ telegram_id: tgId, state, updated_at: new Date().toISOString() });
}
const clearState = (tgId: number) => setState(tgId, {});

async function findStaff(tgId: number) {
  const { data } = await db.from("staff").select("*").eq("telegram_id", tgId).maybeSingle();
  return data && data.is_active && !data.archived_at ? data : null;
}

// ---------- Меню --------------------------------------------------------

function menuFor(role: string) {
  const kb = new Keyboard().resized().persistent();
  if (role === "seamstress") {
    kb.text("🧵 Добавить в закуп").row()
      .webApp("📋 Мои задачи", `${app}/tasks`)
      .webApp("💰 Мой заработок", `${app}/earnings`);
  } else if (role === "manager") {
    kb.webApp("📦 Заказы", `${app}/orders`).webApp("🛒 Закуп", `${app}/supply`).row()
      .webApp("🧑‍🏭 Задачи", `${app}/tasks`).webApp("👤 Заказчики", `${app}/clients`);
  } else {
    kb.webApp("📊 Финансы", `${app}/finance`).webApp("📦 Заказы", `${app}/orders`).row()
      .webApp("💵 Зарплата", `${app}/payroll`).webApp("🛒 Закуп", `${app}/supply`).row()
      .webApp("👥 Сотрудники", `${app}/staff`);
  }
  return kb;
}

const greet = (name: string, role: string) =>
  `Здравствуйте, ${name}!\n\n` +
  (role === "seamstress"
    ? "Здесь ваши задачи, заработок и заявки на закуп материалов."
    : "Uniforma Hub — управление ателье.");

// ---------- /start и вход по номеру -------------------------------------

bot.command("start", async (ctx) => {
  const staff = await findStaff(ctx.from!.id);
  if (staff) {
    await clearState(ctx.from!.id);
    return ctx.reply(greet(staff.full_name, staff.role), { reply_markup: menuFor(staff.role) });
  }
  await ctx.reply(
    "Для входа в Uniforma Hub подтвердите свой номер телефона.\n\n" +
    "Доступ выдаётся администратором ателье — если номера нет в списке сотрудников, вход не откроется.",
    {
      reply_markup: new Keyboard()
        .requestContact("📱 Отправить мой номер").resized().oneTime(),
    },
  );
});

bot.on("message:contact", async (ctx) => {
  const contact = ctx.message.contact;

  // Критично: принимаем только СВОЙ контакт. Иначе кто угодно
  // переслал бы карточку сотрудника и вошёл под ним.
  if (contact.user_id !== ctx.from.id) {
    return ctx.reply("Отправьте, пожалуйста, свой собственный номер кнопкой ниже.");
  }

  let phone: string;
  try {
    phone = normalizePhone(contact.phone_number);
  } catch {
    return ctx.reply("Не удалось распознать номер. Обратитесь к администратору.");
  }

  const { data: staff } = await db.from("staff").select("*").eq("phone", phone).maybeSingle();

  if (!staff || !staff.is_active || staff.archived_at) {
    return ctx.reply(
      `Номер ${phone} не найден среди сотрудников ателье.\n` +
      "Попросите администратора добавить вас в систему.",
      { reply_markup: { remove_keyboard: true } },
    );
  }

  await db.from("staff").update({
    telegram_id: ctx.from.id,
    last_seen_at: new Date().toISOString(),
  }).eq("id", staff.id);

  await db.from("audit_log").insert({
    actor_staff_id: staff.id, action: "auth.linked_telegram",
    target_table: "staff", target_id: staff.id, diff: { telegram_id: ctx.from.id },
  });

  await ctx.reply(greet(staff.full_name, staff.role), { reply_markup: menuFor(staff.role) });
});

// ---------- Заявка на закуп: item -> qty -> urgency ---------------------

bot.hears("🧵 Добавить в закуп", async (ctx) => {
  const staff = await findStaff(ctx.from!.id);
  if (!staff) return ctx.reply("Сначала войдите: /start");

  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await db.from("supply_requests")
    .select("id", { count: "exact", head: true })
    .eq("requested_by_staff_id", staff.id).gte("created_at", since);
  const { data: cfg } = await db.from("app_settings").select("supply_requests_per_hour").eq("id", 1).single();

  if ((count ?? 0) >= (cfg?.supply_requests_per_hour ?? 10)) {
    return ctx.reply("Слишком много заявок за час. Попробуйте позже или напишите менеджеру.");
  }

  // подсказываем то, что этот человек заказывал чаще всего
  const { data: recent } = await db.from("supply_requests")
    .select("item_name_raw, material_id")
    .eq("requested_by_staff_id", staff.id)
    .order("created_at", { ascending: false }).limit(20);

  // callback_data ограничен 64 байтами, поэтому в кнопку кладём только
  // индекс, а сами варианты храним в сессии
  const options: { id: string | null; name: string }[] = [];
  const seen = new Set<string>();
  for (const r of recent ?? []) {
    if (seen.has(r.item_name_raw) || options.length >= 6) continue;
    seen.add(r.item_name_raw);
    options.push({ id: r.material_id, name: r.item_name_raw });
  }
  if (options.length === 0) {
    const { data: mats } = await db.from("materials").select("id,name").eq("is_active", true).limit(6);
    for (const m of mats ?? []) options.push({ id: m.id, name: m.name });
  }

  const kb = new InlineKeyboard();
  options.forEach((o, i) => kb.text(o.name, `sup:item:${i}`).row());
  kb.text("✏️ Другое (написать)", "sup:item:custom");

  await setState(ctx.from!.id, { flow: "supply", step: "item", options });
  await ctx.reply("Что закончилось?", { reply_markup: kb });
});

bot.callbackQuery(/^sup:item:/, async (ctx) => {
  const arg = ctx.callbackQuery.data.slice("sup:item:".length);
  await ctx.answerCallbackQuery();

  if (arg === "custom") {
    await setState(ctx.from.id, { flow: "supply", step: "item_text" });
    return ctx.reply("Напишите название материала:");
  }

  const st = await getState(ctx.from.id);
  const options = (st.options ?? []) as { id: string | null; name: string }[];
  const picked = options[Number(arg)];
  if (!picked) return ctx.reply("Список устарел. Начните заново: «🧵 Добавить в закуп».");

  await setState(ctx.from.id, {
    flow: "supply", step: "qty", material_id: picked.id, item: picked.name,
  });
  await ctx.reply(`«${picked.name}» — сколько нужно? Напишите число.`);
});

bot.callbackQuery(/^sup:urg:/, async (ctx) => {
  const urgency = ctx.callbackQuery.data.split(":")[2];
  const st = await getState(ctx.from.id);
  await ctx.answerCallbackQuery();

  const staff = await findStaff(ctx.from.id);
  if (!staff || st.flow !== "supply") return;

  const { data: row, error } = await db.from("supply_requests").insert({
    requested_by_staff_id: staff.id,
    material_id: st.material_id ?? null,
    item_name_raw: st.item as string,
    qty: st.qty as number,
    unit: (st.unit as string) ?? "шт",
    urgency,
  }).select("id").single();

  await clearState(ctx.from.id);
  if (error) return ctx.reply("Не удалось сохранить заявку. Попробуйте ещё раз.");

  await ctx.reply(
    `✅ Заявка принята\n${st.item} — ${st.qty}\n` +
    (urgency === "blocking" ? "Менеджеру отправлено срочное уведомление." : "Попадёт в ближайший закуп."),
    { reply_markup: menuFor(staff.role) },
  );

  if (urgency === "blocking") {
    await notifyRoles(["manager", "root_admin"],
      `🔴 СРОЧНЫЙ ЗАКУП\n${st.item} — ${st.qty}\nЗапросила: ${staff.full_name}\nПростаивает работа.`);
  }
  void row;
});

// текстовые шаги диалога
bot.on("message:text", async (ctx) => {
  const st = await getState(ctx.from.id);
  if (st.flow !== "supply") return;

  if (st.step === "item_text") {
    const name = ctx.message.text.trim().slice(0, 120);
    await setState(ctx.from.id, { ...st, step: "qty", item: name, material_id: null });
    return ctx.reply(`«${name}» — сколько нужно? Напишите число.`);
  }

  if (st.step === "qty") {
    const qty = Number(ctx.message.text.replace(",", ".").replace(/[^\d.]/g, ""));
    if (!qty || qty <= 0) return ctx.reply("Нужно число, например: 10");

    await setState(ctx.from.id, { ...st, step: "urgency", qty });
    return ctx.reply("Насколько срочно?", {
      reply_markup: new InlineKeyboard()
        .text("🔴 Стоит работа", "sup:urg:blocking").row()
        .text("🟡 Нужно на неделе", "sup:urg:week").row()
        .text("⚪ Про запас", "sup:urg:stock"),
    });
  }
});

// ---------- Исходящие уведомления ---------------------------------------

async function notifyRoles(roles: string[], text: string) {
  const { data } = await db.from("staff")
    .select("telegram_id").in("role", roles).eq("is_active", true).not("telegram_id", "is", null);
  for (const s of data ?? []) {
    try { await bot.api.sendMessage(s.telegram_id!, text); } catch { /* заблокировал бота */ }
  }
}

async function notifyStaff(staffId: string, text: string) {
  const { data } = await db.from("staff").select("telegram_id").eq("id", staffId).single();
  if (data?.telegram_id) {
    try { await bot.api.sendMessage(data.telegram_id, text); } catch { /* ignore */ }
  }
}

// ---------- HTTP --------------------------------------------------------

const handleUpdate = webhookCallback(bot, "std/http", {
  secretToken: WEBHOOK_SECRET(),
});

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Уведомления из БД (Supabase Database Webhooks)
  if (url.pathname.endsWith("/notify")) {
    if (req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET()) {
      return json({ error: "forbidden" }, 403);
    }
    const body = await req.json();

    if (body.type === "task_assigned") {
      await notifyStaff(body.staff_id,
        `🧵 Новая задача\n${body.operation} — ${body.qty}\n` +
        `Оплата: ${uzs(body.amount_uzs)}\n` +
        (body.deadline ? `Срок: ${body.deadline}\n` : "") +
        `Откройте «Мои задачи», чтобы взять в работу.`);
    } else if (body.type === "task_accepted") {
      await notifyStaff(body.staff_id, `✅ Задача принята ОТК. Начислено ${uzs(body.amount_uzs)}.`);
    } else if (body.type === "task_rework") {
      await notifyStaff(body.staff_id, `⚠️ Возврат на переделку.\nПричина: ${body.reason ?? "не указана"}`);
    } else if (body.type === "salary_paid") {
      await notifyStaff(body.staff_id,
        `💵 Выплата ${uzs(body.amount_uzs)}.\nОстаток к выплате: ${uzs(body.balance_uzs)}`);
    } else if (body.type === "finance_lockout") {
      await notifyRoles(["root_admin"], "🚨 Финансы: 5 неверных попыток PIN. Доступ заблокирован на 15 минут.");
    } else if (body.type === "custom") {
      await notifyRoles(body.roles ?? ["root_admin"], body.text);
    }
    return json({ ok: true });
  }

  return await handleUpdate(req);
});
