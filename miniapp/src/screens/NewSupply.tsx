import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useApp } from "../App";
import { db } from "../lib/api";
import { haptic, tg } from "../lib/tg";
import Select from "../components/Select";

const URGENCY = [
  { value: "blocking", label: "🔴 Стоит работа", note: "менеджеру уйдёт уведомление сразу" },
  { value: "week",     label: "🟡 Нужно на неделе" },
  { value: "stock",    label: "⚪ Про запас" },
];

/**
 * Заявка на закуп — переехала из бота.
 * В чате у сотрудников больше нет клавиатур: вся работа в приложении.
 */
export default function NewSupply() {
  const { me } = useApp();
  const nav = useNavigate();
  const [materialId, setMaterialId] = useState("");
  const [custom, setCustom] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("шт");
  const [urgency, setUrgency] = useState("week");
  const [err, setErr] = useState<string | null>(null);

  const materials = useQuery({
    queryKey: ["materials-list"],
    queryFn: async () => {
      const { data, error } = await db().from("materials")
        .select("id,name,unit").eq("is_active", true).order("name");
      if (error) throw error;
      return data;
    },
  });

  const mine = useQuery({
    queryKey: ["my-supply"],
    queryFn: async () => {
      const { data, error } = await db().from("supply_requests")
        .select("id,item_name_raw,qty,unit,status,urgency,created_at")
        .order("created_at", { ascending: false }).limit(10);
      if (error) throw error;
      return data;
    },
  });

  const send = useMutation({
    mutationFn: async () => {
      const name = materialId
        ? materials.data?.find((m) => m.id === materialId)?.name ?? ""
        : custom.trim();
      if (name.length < 2) throw new Error("Выберите материал или напишите название");
      const n = Number(qty.replace(",", "."));
      if (!n || n <= 0) throw new Error("Укажите количество");

      const { error } = await db().from("supply_requests").insert({
        requested_by_staff_id: me.id,
        material_id: materialId || null,
        item_name_raw: name,
        qty: n,
        unit,
        urgency,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      haptic("ok");
      tg().showAlert("Заявка отправлена", () => nav("/profile"));
    },
    onError: (e: Error) => { haptic("err"); setErr(e.message); },
  });

  return (
    <div className="page">
      <div className="h1">Заявка на закуп</div>
      <div className="sub">Что закончилось — напишите, менеджер купит</div>

      <label>Материал</label>
      <Select
        value={materialId}
        onChange={(v) => setMaterialId(v as string)}
        title="Материал"
        placeholder="Выбрать из списка"
        options={[{ value: "", label: "Другое — напишу сам" },
          ...(materials.data ?? []).map((m) => ({ value: m.id, label: m.name, note: m.unit }))]}
      />

      {!materialId && (
        <>
          <label>Название</label>
          <div className="field">
            <span className="ico-l">🧵</span>
            <input value={custom} onChange={(e) => setCustom(e.target.value)}
              placeholder="Резинка широкая белая" />
          </div>
        </>
      )}

      <label>Сколько нужно</label>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={qty} inputMode="decimal" placeholder="10"
          onChange={(e) => setQty(e.target.value.replace(/[^\d.,]/g, ""))} />
        <div style={{ width: 150, flex: "0 0 auto" }}>
          <Select value={unit} onChange={(v) => setUnit(v as string)} title="Единица"
            options={["шт", "м", "катушка", "пара", "уп", "кг"].map((u) => ({ value: u, label: u }))} />
        </div>
      </div>

      <label>Насколько срочно</label>
      <Select value={urgency} onChange={(v) => setUrgency(v as string)}
        title="Срочность" options={URGENCY} />

      {err && <div style={{ color: "var(--danger)", marginTop: 14, fontSize: 14 }}>{err}</div>}

      <div style={{ display: "flex", gap: 8, marginTop: 22 }}>
        <button className="ghost" onClick={() => nav(-1)}>Отмена</button>
        <button onClick={() => send.mutate()} disabled={send.isPending}>Отправить</button>
      </div>

      {(mine.data?.length ?? 0) > 0 && (
        <>
          <div className="stat-label" style={{ margin: "26px 4px 10px" }}>Мои заявки</div>
          {mine.data!.map((r) => (
            <div className="card" key={r.id} style={{ padding: "12px 14px" }}>
              <div className="row">
                <div className="col" style={{ minWidth: 0 }}>
                  <b style={{ fontSize: 15 }}>{r.item_name_raw}</b>
                  <span className="hint">{r.qty} {r.unit}</span>
                </div>
                <span className={"badge " + (r.status === "received" || r.status === "purchased" ? "green"
                  : r.status === "rejected" ? "red" : "amber")}>
                  {r.status === "new" ? "ждёт" : r.status === "approved" ? "одобрено"
                    : r.status === "purchased" ? "куплено" : r.status === "received" ? "получено" : "отклонено"}
                </span>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
