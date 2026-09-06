// Проверка подлинности initData из Telegram Mini App.
// Без этой проверки любой может подделать telegram_id и войти кем угодно.

const enc = new TextEncoder();

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    "raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

export interface TgUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

/**
 * Возвращает пользователя, если подпись верна и данные свежие.
 * maxAgeSec — защита от переигрывания старого initData.
 */
export async function verifyInitData(
  initData: string,
  botToken: string,
  maxAgeSec = 86400,
): Promise<TgUser> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new Error("initData без hash");
  params.delete("hash");

  const checkString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = await hmac(enc.encode("WebAppData"), botToken);
  const signature = hex(await hmac(secret, checkString));

  if (signature !== hash) throw new Error("Неверная подпись initData");

  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) {
    throw new Error("initData просрочен, перезапустите приложение");
  }

  const raw = params.get("user");
  if (!raw) throw new Error("initData без user");
  return JSON.parse(raw) as TgUser;
}

/** Нормализация телефона к E.164 для Узбекистана: +998XXXXXXXXX */
export function normalizePhone(input: string): string {
  const d = input.replace(/\D/g, "");
  if (d.length === 9) return `+998${d}`;
  if (d.length === 12 && d.startsWith("998")) return `+${d}`;
  if (d.length === 13 && d.startsWith("8998")) return `+${d.slice(1)}`;
  throw new Error(`Не удалось разобрать номер: ${input}`);
}

/**
 * Проверка данных Telegram Login Widget (вход с обычного браузера).
 *
 * Схема подписи ОТЛИЧАЕТСЯ от initData:
 *   Login Widget: secret = SHA256(bot_token)
 *   Mini App:     secret = HMAC_SHA256("WebAppData", bot_token)
 * Перепутать их — самая частая ошибка в этом месте.
 */
export interface TgAuth {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export async function verifyLoginWidget(
  auth: TgAuth,
  botToken: string,
  maxAgeSec = 86400,
): Promise<TgUser> {
  const { hash, ...rest } = auth;
  if (!hash) throw new Error("Данные входа без подписи");

  const checkString = Object.entries(rest)
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = new Uint8Array(
    await crypto.subtle.digest("SHA-256", enc.encode(botToken)),
  );
  const signature = hex(await hmac(secret, checkString));

  if (signature !== hash) throw new Error("Неверная подпись данных входа");

  if (!auth.auth_date || Date.now() / 1000 - auth.auth_date > maxAgeSec) {
    throw new Error("Данные входа устарели, войдите заново");
  }

  return {
    id: auth.id,
    first_name: auth.first_name,
    last_name: auth.last_name,
    username: auth.username,
  };
}
