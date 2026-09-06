import { createClient, SupabaseClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export type Role = "root_admin" | "manager" | "seamstress";

export interface Me {
  id: string;
  full_name: string;
  role: Role;
  phone: string;
  has_finance_pin: boolean;
}

export interface Settings {
  finance_idle_lock_seconds: number;
  finance_session_minutes: number;
  rework_forfeits_full: boolean;
}

let token = "";
let client: SupabaseClient | null = null;

/**
 * Клиент Supabase ходит с нашим собственным JWT.
 * Роль и финансовый claim лежат внутри токена и читаются RLS-политиками,
 * поэтому подменить права на клиенте невозможно.
 */
export function db(): SupabaseClient {
  if (!client) {
    client = createClient(URL, ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
  }
  return client;
}

function setToken(t: string) {
  token = t;
  client = null; // пересоздаём клиент, чтобы новый claim попал в заголовки
}

async function call(path: string, body: unknown, auth = true) {
  const res = await fetch(`${URL}/functions/v1/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON,
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.message ?? data.error), { code: data.error, data });
  return data;
}

/** Вход из Mini App: отдаём подписанный Telegram initData. */
export async function signIn(initData: string): Promise<{ me: Me; settings: Settings }> {
  const r = await call("auth", { initData }, false);
  setToken(r.token);
  return { me: r.staff, settings: r.settings };
}

/**
 * Вход из обычного браузера через Telegram Login Widget.
 * Подписанные данные храним локально, чтобы не логиниться при каждом
 * обновлении страницы: подпись всё равно проверяется на сервере,
 * а срок её жизни ограничен полем auth_date.
 */
export async function signInWidget(tgAuth: unknown): Promise<{ me: Me; settings: Settings }> {
  const r = await call("auth", { tgAuth }, false);
  setToken(r.token);
  try { localStorage.setItem("tg_auth", JSON.stringify(tgAuth)); } catch { /* приватный режим */ }
  return { me: r.staff, settings: r.settings };
}

export function storedWidgetAuth(): unknown | null {
  try {
    const raw = localStorage.getItem("tg_auth");
    if (!raw) return null;
    const a = JSON.parse(raw);
    // сервер всё равно отвергнет протухшее, но не будем и пробовать
    if (Date.now() / 1000 - Number(a.auth_date) > 86400) return null;
    return a;
  } catch { return null; }
}

export function forgetWidgetAuth() {
  try { localStorage.removeItem("tg_auth"); } catch { /* ignore */ }
}

export async function unlockFinance(pin: string): Promise<{ finExp: number; idleSeconds: number }> {
  const r = await call("auth/unlock", { pin });
  setToken(r.token);
  return { finExp: r.fin_exp, idleSeconds: r.idle_lock_seconds };
}

export const setFinancePin = (pin: string, currentPin?: string) =>
  call("auth/set-pin", { pin, current_pin: currentPin });

/**
 * Блокировка — это НЕ скрытие экрана, а выброс финансового claim'а:
 * токен без fin_exp RLS просто не пропустит к таблице transactions.
 *
 * В браузере initData нет, поэтому перевыпускаем токен по сохранённым
 * данным Login Widget — иначе замок остался бы чисто визуальным.
 */
export async function lockFinance(initData: string) {
  const body = initData ? { initData } : { tgAuth: storedWidgetAuth() };
  const r = await call("auth", body, false);
  setToken(r.token);
}
