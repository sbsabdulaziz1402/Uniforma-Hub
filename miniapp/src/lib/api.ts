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

/** Вход: отдаём подписанный Telegram initData, получаем рабочий JWT. */
export async function signIn(initData: string): Promise<{ me: Me; settings: Settings }> {
  const r = await call("auth", { initData }, false);
  setToken(r.token);
  return { me: r.staff, settings: r.settings };
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
 */
export async function lockFinance(initData: string) {
  const r = await call("auth", { initData }, false);
  setToken(r.token);
}
