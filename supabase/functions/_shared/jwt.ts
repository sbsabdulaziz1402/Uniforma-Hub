import { SignJWT, jwtVerify } from "npm:jose@5";

const key = (secret: string) => new TextEncoder().encode(secret);

export interface Claims {
  staff_id: string;
  app_role: "root_admin" | "manager" | "seamstress";
  /** unix-время, до которого разблокированы финансы; отсутствует = заблокированы */
  fin_exp?: number;
}

/**
 * Выпускает JWT, совместимый с Supabase (RLS читает claim'ы через
 * current_setting('request.jwt.claims')).
 *
 * ВАЖНО: claim 'role' обязан быть 'authenticated' — это роль Postgres.
 * Роль в нашей системе живёт в отдельном claim'е 'app_role'.
 */
export async function issueToken(c: Claims, secret: string, ttlSec = 60 * 60 * 12) {
  const now = Math.floor(Date.now() / 1000);
  const jwt = new SignJWT({
    role: "authenticated",
    app_role: c.app_role,
    staff_id: c.staff_id,
    ...(c.fin_exp ? { fin_exp: c.fin_exp } : {}),
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(c.staff_id)
    .setAudience("authenticated")
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSec);
  return await jwt.sign(key(secret));
}

export async function readToken(token: string, secret: string) {
  const { payload } = await jwtVerify(token, key(secret), { audience: "authenticated" });
  return payload as unknown as Claims & { exp: number };
}

// ---------- PIN: PBKDF2-SHA256, без внешних зависимостей ----------------
// 6 цифр — это всего 10^6 вариантов, поэтому реальную защиту даёт
// не стойкость хэша, а серверный счётчик попыток (см. finance_failed_attempts).

const ITER = 210_000;
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(pin: string, salt: Uint8Array): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: ITER, hash: "SHA-256" },
    base, 256,
  );
  return new Uint8Array(bits);
}

export async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITER}$${b64(salt)}$${b64(await derive(pin, salt))}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [alg, iter, salt, hash] = stored.split("$");
  if (alg !== "pbkdf2" || Number(iter) !== ITER) return false;
  const got = await derive(pin, unb64(salt));
  const want = unb64(hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];  // без раннего выхода
  return diff === 0;
}
