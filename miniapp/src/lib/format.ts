/** Суммы в БД — целые сумы (BIGINT). Никаких копеек и никакого float. */
export const uzs = (n: number | null | undefined) =>
  new Intl.NumberFormat("ru-RU").format(Math.round(n ?? 0)) + " сум";

/** Компактно для крупных чисел: 12 450 000 -> 12,45 млн */
export const uzsShort = (n: number | null | undefined) => {
  const v = Math.abs(n ?? 0);
  if (v >= 1_000_000) return ((n ?? 0) / 1_000_000).toFixed(2).replace(".", ",") + " млн";
  if (v >= 1_000) return ((n ?? 0) / 1_000).toFixed(0) + " тыс";
  return String(n ?? 0);
};

export const date = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" }) : "—";

export const dateTime = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export const phoneMask = (v: string) => {
  const d = v.replace(/\D/g, "").replace(/^998/, "").slice(0, 9);
  const p = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean);
  return "+998" + (p.length ? " " + p.join(" ") : "");
};

export const toE164 = (masked: string) =>
  "+998" + masked.replace(/\D/g, "").replace(/^998/, "").slice(0, 9);
