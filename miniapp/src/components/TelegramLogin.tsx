import { useEffect, useRef } from "react";

const BOT = (import.meta.env.VITE_BOT_USERNAME as string) || "UniformaHubBot";

/**
 * Кнопка «Log in with Telegram» для обычного браузера.
 *
 * Виджет требует, чтобы домен сайта был привязан к боту:
 * @BotFather → /setdomain. Без этого кнопка отрисуется,
 * но вход будет отклонён самим Telegram.
 */
export default function TelegramLogin({ onAuth }: { onAuth: (user: unknown) => void }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const w = window as unknown as { onTelegramAuth?: (u: unknown) => void };
    w.onTelegramAuth = onAuth;

    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-widget.js?22";
    s.async = true;
    s.setAttribute("data-telegram-login", BOT);
    s.setAttribute("data-size", "large");
    s.setAttribute("data-radius", "14");
    s.setAttribute("data-onauth", "onTelegramAuth(user)");
    s.setAttribute("data-request-access", "write");
    box.current?.appendChild(s);

    return () => { delete w.onTelegramAuth; };
  }, [onAuth]);

  return <div ref={box} style={{ display: "flex", justifyContent: "center", minHeight: 48 }} />;
}
