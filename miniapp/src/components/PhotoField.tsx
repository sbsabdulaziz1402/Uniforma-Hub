import { useState } from "react";
import { db } from "../lib/api";
import { haptic } from "../lib/tg";

/** Загрузка фото-образца в Supabase Storage (публичный бакет catalog). */
export default function PhotoField({
  value, onChange, hint,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  hint?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const upload = async (file: File) => {
    setErr(null);
    if (file.size > 5 * 1024 * 1024) { setErr("Файл больше 5 МБ"); return; }
    setBusy(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `garments/${crypto.randomUUID()}.${ext}`;
      const { error } = await db().storage.from("catalog")
        .upload(path, file, { cacheControl: "31536000", upsert: false });
      if (error) throw error;
      const { data } = db().storage.from("catalog").getPublicUrl(path);
      onChange(data.publicUrl);
      haptic("ok");
    } catch (e) {
      haptic("err");
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="photo-drop">
        {value ? <img src={value} alt="" /> : <span>{busy ? "Загружаем…" : "📷 Нажмите, чтобы выбрать фото"}</span>}
        <input type="file" accept="image/*"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
      </div>
      {hint && !err && <div className="hint" style={{ marginTop: 6 }}>{hint}</div>}
      {err && <div style={{ color: "var(--danger)", marginTop: 6, fontSize: 13 }}>{err}</div>}
      {value && (
        <button className="ghost" style={{ marginTop: 8 }} onClick={() => onChange(null)}>
          Убрать фото
        </button>
      )}
    </>
  );
}
