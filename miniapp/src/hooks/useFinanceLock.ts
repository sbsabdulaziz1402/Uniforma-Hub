import { useCallback, useEffect, useRef, useState } from "react";
import { lockFinance, unlockFinance } from "../lib/api";

const WARN_AT = 5; // за сколько секунд показывать обратный отсчёт

/**
 * Финансовый замок.
 *
 * Экран с PIN'ом сам по себе ничего не защищает — его обходят через DevTools.
 * Реальную защиту даёт claim fin_exp в JWT: блокировка = получение токена
 * без него, после чего RLS перестаёт отдавать строки из transactions.
 *
 * Блокировка срабатывает по трём событиям:
 *   1. бездействие (idleSeconds, по умолчанию 15 — настраивается в app_settings);
 *   2. Telegram свернули (visibilitychange) — мгновенно, без таймера;
 *   3. истёк fin_exp внутри самого токена.
 *
 * Пункт 2 закрывает главный реальный риск («оставил телефон на столе»),
 * пункт 1 — просто гигиена.
 */
export function useFinanceLock(idleSeconds: number, initData: string) {
  const [locked, setLocked] = useState(true);
  const [warning, setWarning] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const deadline = useRef(0);   // когда сработает блокировка по бездействию
  const finExp = useRef(0);     // когда истечёт сам токен

  const lock = useCallback(async () => {
    setLocked(true);
    setWarning(null);
    deadline.current = 0;
    finExp.current = 0;
    try { await lockFinance(initData); } catch { /* всё равно заблокировано в UI */ }
  }, [initData]);

  const touch = useCallback(() => {
    if (!locked) {
      deadline.current = Date.now() + idleSeconds * 1000;
      setWarning(null);
    }
  }, [locked, idleSeconds]);

  const unlock = useCallback(async (pin: string) => {
    setError(null);
    try {
      const r = await unlockFinance(pin);
      finExp.current = r.finExp * 1000;
      deadline.current = Date.now() + (r.idleSeconds || idleSeconds) * 1000;
      setLocked(false);
      return true;
    } catch (e) {
      const err = e as Error & { code?: string; data?: { attempts_left?: number } };
      setError(
        err.code === "locked"   ? "Слишком много попыток. Доступ временно заблокирован."
        : err.code === "bad_pin" ? `Неверный PIN. Осталось попыток: ${err.data?.attempts_left ?? "?"}`
        : err.code === "pin_not_set" ? "PIN не задан. Задайте его в настройках."
        : err.message);
      return false;
    }
  }, [idleSeconds]);

  // Сворачивание Telegram — блокируем немедленно.
  useEffect(() => {
    const onHide = () => { if (document.hidden && !locked) void lock(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
    };
  }, [locked, lock]);

  // Любое касание сбрасывает таймер бездействия.
  useEffect(() => {
    if (locked) return;
    const evs = ["pointerdown", "keydown", "touchmove", "scroll", "wheel"] as const;
    evs.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    return () => evs.forEach((e) => window.removeEventListener(e, touch));
  }, [locked, touch]);

  // Тик раз в секунду: обратный отсчёт и собственно блокировка.
  useEffect(() => {
    if (locked) return;
    const id = setInterval(() => {
      const now = Date.now();
      if (finExp.current && now >= finExp.current) return void lock();

      const left = Math.ceil((deadline.current - now) / 1000);
      if (left <= 0) return void lock();
      setWarning(left <= WARN_AT ? left : null);
    }, 500);
    return () => clearInterval(id);
  }, [locked, lock]);

  return { locked, warning, error, unlock, lock, touch };
}
