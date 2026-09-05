import { useEffect, useState } from "react";
import { haptic } from "../lib/tg";

/** Цифровая клавиатура: 6 цифр набираются одной рукой, пароль — нет. */
export default function PinPad({
  title, subtitle, error, onComplete,
}: {
  title: string;
  subtitle?: string;
  error?: string | null;
  onComplete: (pin: string) => Promise<boolean> | boolean;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (pin.length !== 6 || busy) return;
    setBusy(true);
    Promise.resolve(onComplete(pin)).then((ok) => {
      haptic(ok ? "ok" : "err");
      if (!ok) setPin("");
      setBusy(false);
    });
  }, [pin, busy, onComplete]);

  const push = (d: string) => { haptic(); setPin((p) => (p.length < 6 ? p + d : p)); };

  return (
    <div>
      <div style={{ textAlign: "center", fontSize: 18, fontWeight: 600 }}>{title}</div>
      {subtitle && <div className="hint" style={{ textAlign: "center", marginTop: 6 }}>{subtitle}</div>}

      <div className="pin-dots">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className={"pin-dot" + (i < pin.length ? " on" : "")} />
        ))}
      </div>

      {error && (
        <div style={{ color: "var(--danger)", textAlign: "center", fontSize: 14, marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div className="pad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} onClick={() => push(d)} disabled={busy}>{d}</button>
        ))}
        <button style={{ visibility: "hidden" }} />
        <button onClick={() => push("0")} disabled={busy}>0</button>
        <button onClick={() => { haptic(); setPin((p) => p.slice(0, -1)); }} disabled={busy}>⌫</button>
      </div>
    </div>
  );
}
