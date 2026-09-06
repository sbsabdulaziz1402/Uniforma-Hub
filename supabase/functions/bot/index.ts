// =====================================================================
// Telegram-бот.
//
//   Сотрудник  — видит только синюю кнопку «Открыть» слева от поля ввода,
//                вся работа идёт в Mini App. Клавиатур в чате нет.
//   Клиент     — оформляет заказ прямо в переписке: изделие → материал →
//                количество → цена → подтверждение.
//
//   POST /bot         — webhook Telegram
//   POST /bot/notify  — уведомления из БД, заголовок x-webhook-secret
// =====================================================================

import { Bot, InlineKeyboard, Keyboard, webhookCallback } from "npm:grammy@1";
import { createClient } from "npm:@supabase/supabase-js@2";
import { BOT_TOKEN, MINIAPP_URL, SERVICE_KEY, SUPABASE_URL, WEBHOOK_SECRET, json } from "../_shared/env.ts";
import { normalizePhone } from "../_shared/telegram.ts";

const db = createClient(SUPABASE_URL(), SERVICE_KEY(), { auth: { persistSession: false } });
const bot = new Bot(BOT_TOKEN());
const app = MINIAPP_URL();

const uzs = (n: number) => new Intl.NumberFormat("ru-RU").format(Math.round(n)) + " сум";

// ---------- Сессии диалога ---------------------------------------------

type State = Record<string, unknown>;

async function getState(tgId: number): Promise<State> {
  const { data } = await db.from("bot_sessions").select("state").eq("telegram_id", tgId).maybeSingle();
  return (data?.state ?? {}) as State;
}
const setState = (tgId: number, state: State) =>
  db.from("bot_sessions").upsert({ telegram_id: tgId, state, updated_at: new Date().toISOString() });
const clearState = (tgId: number) => setState(tgId, {});

async function findStaff(tgId: number) {
  const { data } = await db.from("staff").select("*").eq("telegram_id", tgId).maybeSingle();
  return data && data.is_active && !data.archived_at ? data : null;
}

// ---------- Кнопка «Открыть» -------------------------------------------
// Персональная на чат: сотруднику — вход в Mini App, клиенту — обычное меню,
// иначе он нажмёт «Открыть» и упрётся в «доступ не выдан».

async function setMenu(chatId: number, forStaff: boolean) {
  try {
    await bot.api.setChatMenuButton({
      chat_id: chatId,
      menu_button: forStaff
        ? { type: "web_app", text: "Открыть", web_app: { url: app } }
        : { type: "commands" },
    });
  } catch { /* старый клиент — переживём */ }
}

// ---------- /start ------------------------------------------------------

bot.command("start", async (ctx) => {
  const tgId = ctx.from!.id;
  await clearState(tgId);

  const staff = await findStaff(tgId);
  if (staff) {
    await setMenu(ctx.chat.id, true);
    await db.from("staff").update({ last_seen_at: new Date().toISOString() }).eq("id", staff.id);
    return ctx.reply(
      `Здравствуйте, ${staff.full_name}!\n\n` +
      `Вся работа — в приложении: нажмите синюю кнопку «Открыть» слева от поля ввода.`,
      { reply_markup: { remove_keyboard: true } },
    );
  }

  await setMenu(ctx.chat.id, false);
  await ctx.reply(
    "Ателье «Uniforma Hub» — пошив форменной одежды на заказ.\n\n" +
    "Выберите изделие и материал — увидите стоимость сразу, до оформления.",
    { reply_markup: new InlineKeyboard().text("🧵 Оформить заказ", "ord:start") },
  );
});

// Сотрудник мог войти после того, как уже писал боту как гость
bot.command("app", async (ctx) => {
  const staff = await findStaff(ctx.from!.id);
  if (!staff) return ctx.reply("Приложение доступно сотрудникам ателье.");
  await setMenu(ctx.chat.id, true);
  await ctx.reply("Открыть Uniforma Hub:", {
    reply_markup: new InlineKeyboard().webApp("🚀 Открыть приложение", app),
  });
});

// ---------- Оформление заказа клиентом ----------------------------------

async function showGarments(ctx: { reply: (t: string, o?: unknown) => Promise<unknown> }, tgId: number) {
  const { data: garments } = await db.from("garment_types")
    .select("id,name,base_price_uzs").eq("is_active", true).order("sort_order");

  if (!garments?.length) {
    return ctx.reply("Каталог пока пуст. Напишите нам позже.");
  }

  const kb = new InlineKeyboard();
  garments.forEach((g, i) => kb.text(`${g.name} — ${uzs(g.base_price_uzs)}`, `ord:g:${i}`).row());

  await setState(tgId, { flow: "order", step: "garment", garments });
  await ctx.reply("Что будем шить?", { reply_markup: kb });
}

bot.callbackQuery("ord:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showGarments(ctx, ctx.from.id);
});

bot.callbackQuery(/^ord:g:\d+$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const st = await getState(ctx.from.id);
  const garments = (st.garments ?? []) as { id: string; name: string; base_price_uzs: number }[];
  const g = garments[Number(ctx.callbackQuery.data.split(":")[2])];
  if (!g) return ctx.reply("Список устарел, начните заново: /start");

  // материалы, привязанные к изделию; если привязок нет — показываем общие
  const { data: linked } = await db.from("material_garments")
    .select("materials(id,name,price_per_unit_uzs,client_visible)")
    .eq("garment_type_id", g.id);

  let materials = (linked ?? [])
    .map((r) => (r as unknown as { materials: Material }).materials)
    .filter((m) => m && m.client_visible);

  if (!materials.length) {
    const { data } = await db.from("materials")
      .select("id,name,price_per_unit_uzs,client_visible")
      .eq("is_active", true).eq("client_visible", true).limit(8);
    materials = (data ?? []) as Material[];
  }

  const kb = new InlineKeyboard();
  materials.forEach((m, i) => {
    const add = m.price_per_unit_uzs > 0 ? ` (+${uzs(m.price_per_unit_uzs)})` : "";
    kb.text(`${m.name}${add}`, `ord:m:${i}`).row();
  });
  kb.text("Без выбора материала", "ord:m:-1");

  await setState(ctx.from.id, { ...st, step: "material", garment: g, materials });
  await ctx.reply(`${g.name} — ${uzs(g.base_price_uzs)}\n\nИз какого материала?`, { reply_markup: kb });
});

bot.callbackQuery(/^ord:m:-?\d+$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const st = await getState(ctx.from.id);
  const idx = Number(ctx.callbackQuery.data.split(":")[2]);
  const materials = (st.materials ?? []) as Material[];
  const m = idx >= 0 ? materials[idx] : null;

  await setState(ctx.from.id, { ...st, step: "qty", material: m });
  await ctx.reply("Сколько штук? Напишите число.");
});

bot.callbackQuery("ord:confirm", async (ctx) => {
  await ctx.answerCallbackQuery();
  const st = await getState(ctx.from.id);

  const { data: client } = await db.from("clients")
    .select("id,phone,name").eq("telegram_id", ctx.from.id).maybeSingle();

  if (!client?.phone) {
    await setState(ctx.from.id, { ...st, step: "contact" });
    return ctx.reply(
      "Остался последний шаг — подтвердите номер телефона, чтобы мы могли связаться.",
      { reply_markup: new Keyboard().requestContact("📱 Отправить мой номер").resized().oneTime() },
    );
  }
  await createOrder(ctx, st, client.id);
});

bot.callbackQuery("ord:restart", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showGarments(ctx, ctx.from.id);
});

// ---------- Контакт: и вход сотрудника, и подтверждение клиента ---------

bot.on("message:contact", async (ctx) => {
  const contact = ctx.message.contact;

  // принимаем только собственный контакт: иначе пересланной карточкой
  // можно было бы войти под чужим сотрудником
  if (contact.user_id !== ctx.from.id) {
    return ctx.reply("Отправьте, пожалуйста, свой собственный номер кнопкой ниже.");
  }

  let phone: string;
  try { phone = normalizePhone(contact.phone_number); }
  catch { return ctx.reply("Не удалось распознать номер."); }

  // 1) это сотрудник?
  const { data: staff } = await db.from("staff").select("*").eq("phone", phone).maybeSingle();
  if (staff && staff.is_active && !staff.archived_at) {
    await db.from("staff").update({
      telegram_id: ctx.from.id, last_seen_at: new Date().toISOString(),
    }).eq("id", staff.id);
    await db.from("audit_log").insert({
      actor_staff_id: staff.id, action: "auth.linked_telegram",
      target_table: "staff", target_id: staff.id, diff: { telegram_id: ctx.from.id },
    });
    await setMenu(ctx.chat.id, true);
    return ctx.reply(
      `Здравствуйте, ${staff.full_name}!\n\nНажмите синюю кнопку «Открыть» слева от поля ввода.`,
      { reply_markup: { remove_keyboard: true } },
    );
  }

  // 2) значит клиент — заводим карточку и завершаем заказ
  const fullName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || phone;
  const { data: existing } = await db.from("clients").select("id").eq("phone", phone).maybeSingle();

  let clientId = existing?.id;
  if (clientId) {
    await db.from("clients").update({ telegram_id: ctx.from.id }).eq("id", clientId);
  } else {
    const { data, error } = await db.from("clients")
      .insert({ name: fullName, phone, telegram_id: ctx.from.id }).select("id").single();
    if (error) return ctx.reply("Не удалось сохранить контакт. Попробуйте позже.");
    clientId = data.id;
  }

  const st = await getState(ctx.from.id);
  if (st.flow === "order" && st.garment) {
    return createOrder(ctx, st, clientId!);
  }
  await ctx.reply("Спасибо! Номер сохранён.", { reply_markup: { remove_keyboard: true } });
});

// ---------- Количество текстом ------------------------------------------

bot.on("message:text", async (ctx) => {
  const st = await getState(ctx.from.id);
  if (st.flow !== "order" || st.step !== "qty") return;

  const qty = Number(ctx.message.text.replace(/\D/g, ""));
  if (!qty || qty < 1) return ctx.reply("Нужно число, например: 2");

  const g = st.garment as Garment;
  const m = st.material as Material | null;
  const unit = g.base_price_uzs + (m?.price_per_unit_uzs ?? 0);
  const total = unit * qty;

  await setState(ctx.from.id, { ...st, step: "confirm", qty, unit, total });

  await ctx.reply(
    `Ваш заказ:\n\n` +
    `${g.name}${m ? `, ${m.name}` : ""}\n` +
    `${qty} шт × ${uzs(unit)}\n\n` +
    `Итого: ${uzs(total)}\n\n` +
    `Цена предварительная — точную подтвердит менеджер после замеров.`,
    {
      reply_markup: new InlineKeyboard()
        .text("✅ Оформить заказ", "ord:confirm").row()
        .text("✏️ Выбрать заново", "ord:restart"),
    },
  );
});

// ---------- Создание заказа ---------------------------------------------

async function createOrder(
  ctx: { from: { id: number }; reply: (t: string, o?: unknown) => Promise<unknown> },
  st: State,
  clientId: string,
) {
  const g = st.garment as Garment;
  const m = st.material as Material | null;
  const qty = Number(st.qty ?? 1);
  const unit = Number(st.unit ?? g.base_price_uzs);

  const { data: order, error } = await db.from("orders").insert({
    client_id: clientId,
    title: `${g.name} — ${qty} шт`,
    source: "client_bot",
  }).select("id,number").single();

  if (error) {
    await clearState(ctx.from.id);
    return ctx.reply("Не удалось оформить заявку. Позвоните нам, пожалуйста.");
  }

  await db.from("order_items").insert({
    order_id: order.id,
    garment_type: g.name,
    qty,
    unit_price_uzs: unit,
    material_id: m?.id ?? null,
  });

  await clearState(ctx.from.id);

  await ctx.reply(
    `✅ Заявка ${order.number} принята!\n\n` +
    `${g.name}${m ? `, ${m.name}` : ""} — ${qty} шт\n` +
    `Предварительно: ${uzs(unit * qty)}\n\n` +
    `Менеджер свяжется с вами в ближайшее время и согласует замеры.`,
    { reply_markup: { remove_keyboard: true } },
  );

  await notifyRoles(["manager", "root_admin"],
    `🆕 Заявка из бота — ${order.number}\n${g.name}${m ? `, ${m.name}` : ""} — ${qty} шт\n` +
    `Предварительно: ${uzs(unit * qty)}`);
}

// ---------- Уведомления --------------------------------------------------

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

// ---------- HTTP ---------------------------------------------------------

const handleUpdate = webhookCallback(bot, "std/http", { secretToken: WEBHOOK_SECRET() });

Deno.serve(async (req) => {
  if (new URL(req.url).pathname.endsWith("/notify")) {
    if (req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET()) {
      return json({ error: "forbidden" }, 403);
    }
    const b = await req.json();

    if (b.type === "task_assigned") {
      await notifyStaff(b.staff_id,
        `🧵 Новая задача: ${b.operation} — ${b.qty}\n` +
        (b.deadline ? `Срок: ${b.deadline}\n` : "") +
        "Откройте приложение кнопкой «Открыть».");
    } else if (b.type === "task_accepted") {
      await notifyStaff(b.staff_id, `✅ Задача принята ОТК. Начислено ${uzs(b.amount_uzs)}.`);
    } else if (b.type === "task_rework") {
      await notifyStaff(b.staff_id, `⚠️ Возврат на переделку.\nПричина: ${b.reason ?? "не указана"}`);
    } else if (b.type === "salary_paid") {
      await notifyStaff(b.staff_id, `💵 Выплата ${uzs(b.amount_uzs)}. Остаток: ${uzs(b.balance_uzs)}`);
    } else if (b.type === "supply_blocking") {
      await notifyRoles(["manager", "root_admin"],
        `🔴 СРОЧНЫЙ ЗАКУП\n${b.item} — ${b.qty}\nЗапросила: ${b.who}`);
    } else if (b.type === "custom") {
      await notifyRoles(b.roles ?? ["root_admin"], b.text);
    }
    return json({ ok: true });
  }

  return await handleUpdate(req);
});

interface Garment { id: string; name: string; base_price_uzs: number }
interface Material { id: string; name: string; price_per_unit_uzs: number; client_visible: boolean }
