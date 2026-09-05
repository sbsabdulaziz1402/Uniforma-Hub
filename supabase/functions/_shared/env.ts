export function env(name: string, required = true): string {
  const v = Deno.env.get(name) ?? "";
  if (required && !v) throw new Error(`Не задана переменная окружения ${name}`);
  return v;
}

export const BOT_TOKEN      = () => env("TELEGRAM_BOT_TOKEN");
export const WEBHOOK_SECRET = () => env("TELEGRAM_WEBHOOK_SECRET");
export const JWT_SECRET     = () => env("SUPABASE_JWT_SECRET");
export const SUPABASE_URL   = () => env("SUPABASE_URL");
export const SERVICE_KEY    = () => env("SUPABASE_SERVICE_ROLE_KEY");
export const MINIAPP_URL    = () => env("MINIAPP_URL");

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
