import { ReactNode, useEffect } from "react";
import { useApp } from "../App";
import { useFinanceLock } from "../hooks/useFinanceLock";
import PinPad from "./PinPad";

/**
 * Обёртка для финансовых экранов.
 *
 * Замок не «прячет» данные — он выбрасывает claim fin_exp из токена,
 * после чего Postgres перестаёт отдавать строки. Скрытый div можно
 * посмотреть в DevTools, отсутствующие в ответе строки — нет.
 */
export default function FinanceGate({ children }: { children: ReactNode }) {
  const { settings, initData, me } = useApp();
  const { locked, warning, error, unlock } = useFinanceLock(
    settings.finance_idle_lock_seconds, initData,
  );

  // Превью приложения в списке задач телефона не должно показывать выручку:
  // на время ухода в фон размываем всё содержимое.
  useEffect(() => {
    const blur = () => document.body.classList.toggle("blurred", document.hidden);
    document.addEventListener("visibilitychange", blur);
    return () => {
      document.removeEventListener("visibilitychange", blur);
      document.body.classList.remove("blurred");
    };
  }, []);

  if (locked) {
    return (
      <div className="lock">
        <div style={{ width: "100%", maxWidth: 340 }}>
          <PinPad
            title="Финансы"
            subtitle={me.has_finance_pin
              ? "Введите PIN для доступа к отчётам"
              : "PIN не задан. Задайте его в разделе «Люди» → ваш профиль."}
            error={error}
            onComplete={unlock}
          />
        </div>
      </div>
    );
  }

  return (
    <>
      {warning !== null && (
        <div className="card" style={{
          position: "sticky", top: 0, zIndex: 10, margin: 0,
          background: "var(--warning)", color: "#fff", textAlign: "center",
          borderRadius: 0, padding: "8px 12px", fontSize: 14,
        }}>
          Блокировка через {warning} с — коснитесь экрана
        </div>
      )}
      {children}
    </>
  );
}
