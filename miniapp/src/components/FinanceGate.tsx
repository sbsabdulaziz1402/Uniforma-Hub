import { ReactNode, useEffect, useState } from "react";
import { useApp } from "../App";
import { useFinanceLock } from "../hooks/useFinanceLock";
import { setFinancePin } from "../lib/api";
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

  // Если PIN ещё не задан, задаём его прямо здесь: экран замка перекрывает
  // навигацию, и уйти отсюда в другой раздел иначе невозможно.
  const [needPin, setNeedPin] = useState(!me.has_finance_pin);
  const [stage, setStage] = useState<"first" | "confirm">("first");
  const [firstPin, setFirstPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);

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

  const createPin = async (pin: string) => {
    if (stage === "first") {
      setFirstPin(pin);
      setStage("confirm");
      setPinError(null);
      return true;
    }
    if (pin !== firstPin) {
      setFirstPin("");
      setStage("first");
      setPinError("PIN не совпал. Задайте заново.");
      return false;
    }
    try {
      await setFinancePin(pin);
      setNeedPin(false);
      await unlock(pin);         // сразу входим, второй раз набирать не нужно
      return true;
    } catch (e) {
      setPinError((e as Error).message);
      setFirstPin("");
      setStage("first");
      return false;
    }
  };

  if (locked) {
    return (
      <div className="lock">
        <div style={{ width: "100%", maxWidth: 340 }}>
          {needPin ? (
            <PinPad
              key={stage + firstPin}   // перемонтируем, чтобы точки сбросились
              title={stage === "first" ? "Задайте PIN" : "Повторите PIN"}
              subtitle={stage === "first"
                ? "6 цифр. Понадобится при каждом входе в отчёты."
                : "Ещё раз — чтобы не ошибиться в цифре."}
              error={pinError}
              onComplete={createPin}
            />
          ) : (
            <PinPad
              title="Финансы"
              subtitle="Введите PIN для доступа к отчётам"
              error={error}
              onComplete={unlock}
            />
          )}
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
