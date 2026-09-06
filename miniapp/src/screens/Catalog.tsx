import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "../lib/api";
import { haptic, tg } from "../lib/tg";

/** Справочники изделий и материалов — один экран на оба. */
export default function Catalog() {
  const { kind } = useParams<{ kind: "garments" | "materials" }>();
  const isGarments = kind === "garments";
  const nav = useNavigate();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

  const table = isGarments ? "garment_types" : "materials";

  const items = useQuery({
    queryKey: ["catalog", table],
    queryFn: async () => {
      const { data, error } = await db()
        .from(table)
        .select(isGarments
          ? "id,name,is_active,sort_order,operations:default_operation_id(name,default_rate_uzs)"
          : "id,name,unit,stock_qty,min_qty,is_active")
        .order(isGarments ? "sort_order" : "name");
      if (error) throw error;
      return data as unknown as Row[];
    },
  });

  const toggle = useMutation({
    mutationFn: async (r: Row) => {
      const { error } = await db().from(table).update({ is_active: !r.is_active }).eq("id", r.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog", table] }),
    onError: (e: Error) => tg().showAlert(e.message),
  });

  if (adding) {
    return <AddForm isGarments={isGarments} table={table}
      onDone={() => { setAdding(false); qc.invalidateQueries({ queryKey: ["catalog", table] }); }} />;
  }

  return (
    <div className="page">
      <div className="h1">{isGarments ? "Изделия" : "Материалы"}</div>
      <div className="sub">
        {isGarments
          ? "Что ателье шьёт. Список появляется при оформлении заказа."
          : "Что закупается. Швеи выбирают отсюда в заявках на закуп."}
      </div>

      <button onClick={() => { haptic(); setAdding(true); }}>
        + Добавить {isGarments ? "изделие" : "материал"}
      </button>

      <div style={{ marginTop: 16 }}>
        {(items.data ?? []).map((r) => (
          <div className="card" key={r.id}>
            <div className="row">
              <div className="col" style={{ minWidth: 0 }}>
                <b>{r.name}</b>
                <span className="hint">
                  {isGarments
                    ? (r.operations?.name ?? "операция не задана")
                    : `${r.unit} · остаток ${r.stock_qty ?? 0}`}
                </span>
              </div>
              <span className={"badge " + (r.is_active ? "green" : "")}>
                {r.is_active ? "активно" : "скрыто"}
              </span>
            </div>
            <button className="ghost" style={{ marginTop: 12 }} onClick={() => toggle.mutate(r)}>
              {r.is_active ? "Скрыть" : "Вернуть"}
            </button>
          </div>
        ))}
        {items.data?.length === 0 && <div className="empty">Пока пусто</div>}
      </div>

      <button className="ghost" style={{ marginTop: 8 }} onClick={() => nav("/profile")}>Назад</button>
    </div>
  );
}

function AddForm({ isGarments, table, onDone }: {
  isGarments: boolean; table: string; onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("шт");
  const [minQty, setMinQty] = useState("0");
  const [operationId, setOperationId] = useState("");
  const [newOpRate, setNewOpRate] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const operations = useQuery({
    queryKey: ["operations"],
    enabled: isGarments,
    queryFn: async () => {
      const { data, error } = await db()
        .from("operations").select("id,name,default_rate_uzs")
        .eq("is_active", true).order("name");
      if (error) throw error;
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (name.trim().length < 2) throw new Error("Укажите название");

      if (!isGarments) {
        const { error } = await db().from("materials")
          .insert({ name: name.trim(), unit, min_qty: Number(minQty) || 0 });
        if (error) throw new Error(error.code === "23505" ? "Такой материал уже есть" : error.message);
        return;
      }

      // Изделию нужна операция — иначе задача швее не создастся автоматически.
      // Если подходящей нет, заводим её тут же вместе с расценкой.
      let opId = operationId;
      if (!opId) {
        const rate = Number(newOpRate.replace(/\D/g, ""));
        if (!rate) throw new Error("Выберите операцию или укажите расценку для новой");
        const { data, error } = await db().from("operations")
          .insert({ name: `Пошив: ${name.trim()}`, unit: "шт", default_rate_uzs: rate })
          .select("id").single();
        if (error) throw error;
        opId = data.id;
      }

      const { error } = await db().from("garment_types")
        .insert({ name: name.trim(), default_operation_id: opId });
      if (error) throw new Error(error.code === "23505" ? "Такое изделие уже есть" : error.message);
    },
    onSuccess: () => { haptic("ok"); onDone(); },
    onError: (e: Error) => { haptic("err"); setErr(e.message); },
  });

  return (
    <div className="page">
      <div className="h1">{isGarments ? "Новое изделие" : "Новый материал"}</div>

      <label>Название</label>
      <div className="field">
        <span className="ico-l">{isGarments ? "👕" : "🧵"}</span>
        <input value={name} onChange={(e) => setName(e.target.value)}
          placeholder={isGarments ? "Китель парадный" : "Нитки белые №40"} />
      </div>

      {isGarments ? (
        <>
          <label>Операция пошива</label>
          <select value={operationId} onChange={(e) => setOperationId(e.target.value)}>
            <option value="">Создать новую</option>
            {(operations.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          {!operationId && (
            <>
              <label>Расценка швее за штуку (сум)</label>
              <input value={newOpRate} inputMode="numeric"
                onChange={(e) => setNewOpRate(e.target.value.replace(/\D/g, ""))}
                placeholder="180000" />
              <div className="hint" style={{ marginTop: 6 }}>
                По ней начисляется зарплата за принятую задачу.
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <label>Единица</label>
          <select value={unit} onChange={(e) => setUnit(e.target.value)}>
            {["шт", "м", "катушка", "пара", "уп", "кг"].map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>

          <label>Минимальный остаток</label>
          <input value={minQty} inputMode="numeric"
            onChange={(e) => setMinQty(e.target.value.replace(/\D/g, ""))} />
          <div className="hint" style={{ marginTop: 6 }}>
            Ниже этого значения материал считается заканчивающимся.
          </div>
        </>
      )}

      {err && <div style={{ color: "var(--danger)", marginTop: 14, fontSize: 14 }}>{err}</div>}

      <div style={{ display: "flex", gap: 8, marginTop: 22 }}>
        <button className="ghost" onClick={onDone}>Отмена</button>
        <button onClick={() => save.mutate()} disabled={save.isPending}>Сохранить</button>
      </div>
    </div>
  );
}

interface Row {
  id: string; name: string; is_active: boolean;
  unit?: string; stock_qty?: number; min_qty?: number;
  operations?: { name: string; default_rate_uzs: number } | null;
}
