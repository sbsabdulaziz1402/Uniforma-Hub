// Тонкая обёртка над Telegram.WebApp — без SDK, чтобы не тащить лишнюю зависимость.

interface WebApp {
  initData: string;
  colorScheme: "light" | "dark";
  themeParams: Record<string, string>;
  ready(): void;
  expand(): void;
  close(): void;
  HapticFeedback?: {
    impactOccurred(style: "light" | "medium" | "heavy"): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
  };
  MainButton: {
    setText(t: string): void; show(): void; hide(): void;
    onClick(cb: () => void): void; offClick(cb: () => void): void;
    showProgress(l?: boolean): void; hideProgress(): void;
  };
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  showConfirm(msg: string, cb: (ok: boolean) => void): void;
  showAlert(msg: string, cb?: () => void): void;
  disableVerticalSwipes?(): void;
}

export const tg = (): WebApp =>
  (window as unknown as { Telegram: { WebApp: WebApp } }).Telegram.WebApp;

export const haptic = (kind: "tap" | "ok" | "err" = "tap") => {
  const h = tg().HapticFeedback;
  if (!h) return;
  if (kind === "ok") h.notificationOccurred("success");
  else if (kind === "err") h.notificationOccurred("error");
  else h.impactOccurred("light");
};

export const confirm = (msg: string) =>
  new Promise<boolean>((res) => tg().showConfirm(msg, res));

/**
 * Достаёт initData из всех мест, куда Telegram их кладёт.
 *
 * WebApp.initData на части клиентов остаётся пустым (Desktop/macOS,
 * открытие из кешированной клавиатуры), но сами данные при этом есть
 * во фрагменте URL и в sessionStorage — их пишет telegram-web-app.js.
 */
export function getInitData(): string {
  try {
    const fromSdk = tg().initData;
    if (fromSdk) return fromSdk;
  } catch { /* SDK не загрузился */ }

  // 1) фрагмент URL: #tgWebAppData=...
  try {
    const p = new URLSearchParams(location.hash.replace(/^#/, ""));
    const v = p.get("tgWebAppData");
    if (v) return v;
  } catch { /* пусто */ }

  // 2) то, что telegram-web-app.js сохранил при первом запуске
  try {
    const raw = sessionStorage.getItem("__telegram__initParams");
    if (raw) {
      const v = JSON.parse(raw)?.tgWebAppData;
      if (v) return v as string;
    }
  } catch { /* приватный режим */ }

  return "";
}

/** Что реально видно на клиенте — для экрана ошибки. */
export function diagnostics(): Record<string, string> {
  let w: Partial<WebApp> = {};
  try { w = tg(); } catch { /* нет SDK */ }
  let stored = "нет";
  try { stored = sessionStorage.getItem("__telegram__initParams") ? "есть" : "нет"; } catch { stored = "недоступен"; }
  return {
    "Telegram SDK": (window as unknown as { Telegram?: unknown }).Telegram ? "загружен" : "НЕ загружен",
    "версия": (w as { version?: string }).version ?? "—",
    "платформа": (w as { platform?: string }).platform ?? "—",
    "initData (SDK)": w.initData ? `${w.initData.length} символов` : "пусто",
    "хеш URL": location.hash ? `${location.hash.slice(0, 60)}…` : "пусто",
    "путь": location.pathname,
    "sessionStorage": stored,
  };
}
