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
