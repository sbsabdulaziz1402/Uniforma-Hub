import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "../lib/api";
import { haptic, tg } from "../lib/tg";
import Select from "../components/Select";
import PhotoField from "../components/PhotoField";

type Kind = "garments" | "materials" | "agencies";

const CFG = {
  garments:  { table: "garment_types", title: "Изделия",   one: "изделие",  icon: "👕",
               sub: "Что ателье шьёт. Этот список появляется при оформлении заказа." },
  materials: { table: "materials",     title: "Материалы", one: "материал", icon: "🧵",
               sub: "Что закупается. Швеи выбирают отсюда в заявках на закуп." },
  agencies:  { table: "agencies",      title: "Госорганы", one: "орган",    icon: "🏛",
               sub: "Ведомства-заказчики. Привязываются к изделиям и клиентам." },
} as const;

export default function Catalog() {
  const { kind = "garments" } = useParams<{ kind: Kind }>();
  const cfg = CFG[kind as Kind] ?? CFG.garments;
  const nav = useNavigate();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

  const items = useQuery({
    queryKey: ["catalog", cfg.table],
    queryFn: async () => {
      const select = kind === "garments"
        ? "id,name,is_active,photo_url,base_price_uzs,agencies:agency_id(name),operations:default_operation_id(name)"
        : kind === "materials"
        ? "id,name,unit,stock_qty,is_active"
        : "id,name,short_name,is_active";
      const { data, error } = await db().from(cfg.table).select(select).order("name");
      if (error) throw error;
      return data as unknown as Row[];
    },
  });

  const toggle = useMutation({
    mutationFn: async (r: Row) => {
      const { error } = await db().from(cfg.table).update({ is_active: !r.is_active }).eq("id", r.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog", cfg.table] }),
    onError: (e: Error) => tg().showAlert(e.message),
  });

  if (adding) {
    return <AddForm kind={kind as Kind}
      onDone={() => { setAdding(false); qc.invalidateQueries(); }} />;
  }

  return (
    <div className="page">
      <div className="h1">{cfg.title}</div>
      <div className="sub">{cfg.sub}</div>

      <button onClick={() => { haptic(); setAdding(true); }}>+ Добавить {cfg.one}</button>

      <div style={{ marginTop: 16 }}>
        {(items.data ?? []).map((r) => (
          <div className="card" key={r.id}>
            <div className="row">
              {r.photo_url && (
                <img src={r.photo_url} alt=""
                  style={{ width: 52, height: 52, borderRadius: 12, objectFit: "cover", flex: "0 0 auto" }} />
              )}
              <div className="col" style={{ minWidth: 0, flex: 1 }}>
                <b>{r.name}</b>
                <span className="hint">
                  {kind === "garments"
                    ? [r.base_price_uzs ? `${new Intl.NumberFormat("ru-RU").format(r.base_price_uzs)} сум` : null,
                       r.agencies?.name].filter(Boolean).join(" · ") || "цена не задана"
                    : kind === "materials"
                    ? `${r.unit} · остаток ${r.stock_qty ?? 0}`
                    : r.short_name ?? ""}
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

function AddForm({ kind, onDone }: { kind: Kind; onDone: () => void }) {
  const cfg = CFG[kind];
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [agencyId, setAgencyId] = useState("");
  const [operationId, setOperationId] = useState("");
  const [newOpRate, setNewOpRate] = useState("");
  const [unit, setUnit] = useState("шт");
  const [minQty, setMinQty] = useState("0");
  const [price, setPrice] = useState("");
  const [garmentIds, setGarmentIds] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const agencies = useQuery({
    queryKey: ["agencies"], enabled: kind === "garments",
    queryFn: async () => {
      const { data, error } = await db().from("agencies")
        .select("id,name").eq("is_active", true).order("name");
      if (error) throw error;
      return data;
    },
  });

  const operations = useQuery({
    queryKey: ["operations"], enabled: kind === "garments",
    queryFn: async () => {
      const { data, error } = await db().from("operations")
        .select("id,name,default_rate_uzs").eq("is_active", true).order("name");
      if (error) throw error;
      return data;
    },
  });

  const garments = useQuery({
    queryKey: ["garments-all"], enabled: kind === "materials",
    queryFn: async () => {
      const { data, error } = await db().from("garment_types")
        .select("id,name").eq("is_active", true).order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (name.trim().length < 2) throw new Error("Укажите название");

      if (kind === "agencies") {
        const { error } = await db().from("agencies")
          .insert({ name: name.trim(), short_name: shortName.trim() || null });
        if (error) throw new Error(error.code === "23505" ? "Такой орган уже есть" : error.message);
        return;
      }

      if (kind === "materials") {
        const { data, error } = await db().from("materials")
          .insert({
            name: name.trim(), unit,
            min_qty: Number(minQty) || 0,
            price_per_unit_uzs: Number(price.replace(/\D/g, "")) || 0,
          })
          .select("id").single();
        if (error) throw new Error(error.code === "23505" ? "Такой материал уже есть" : error.message);

        // на какие изделия идёт этот материал
        if (garmentIds.length) {
          const { error: lErr } = await db().from("material_garments")
            .insert(garmentIds.map((g) => ({ material_id: data.id, garment_type_id: g })));
          if (lErr) throw lErr;
        }
        return;
      }

      // Изделию нужна операция с расценкой — без неё задача швее
      // не создастся автоматически при оформлении заказа.
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

      const { error } = await db().from("garment_types").insert({
        name: name.trim(),
        default_operation_id: opId,
        agency_id: agencyId || null,
        photo_url: photo,
        base_price_uzs: Number(price.replace(/\D/g, "")) || 0,
      });
      if (error) throw new Error(error.code === "23505" ? "Такое изделие уже есть" : error.message);
    },
    onSuccess: () => { haptic("ok"); onDone(); },
    onError: (e: Error) => { haptic("err"); setErr(e.message); },
  });

  return (
    <div className="page">
      <div className="h1">Новый {cfg.one}</div>

      {kind === "garments" && (
        <>
          <label>Фото образца</label>
          <PhotoField value={photo} onChange={setPhoto}
            hint="Швея увидит его в задаче — меньше вопросов по крою." />
        </>
      )}

      <label>Название</label>
      <div className="field">
        <span className="ico-l">{cfg.icon}</span>
        <input value={name} onChange={(e) => setName(e.target.value)}
          placeholder={kind === "garments" ? "Китель парадный"
            : kind === "materials" ? "Нитки белые №40" : "ГУВД г. Ташкента"} />
      </div>

      {kind === "agencies" && (
        <>
          <label>Сокращённо <span className="hint">— необязательно</span></label>
          <input value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="ГУВД" />
        </>
      )}

      {kind === "garments" && (
        <>
          <label>Для какого органа</label>
          <Select
            value={agencyId}
            onChange={(v) => setAgencyId(v as string)}
            title="Госорган"
            placeholder="Не привязано"
            options={[{ value: "", label: "Не привязано" },
              ...(agencies.data ?? []).map((a) => ({ value: a.id, label: a.name }))]}
          />

          <label>Операция пошива</label>
          <Select
            value={operationId}
            onChange={(v) => setOperationId(v as string)}
            title="Операция"
            placeholder="Создать новую"
            options={[{ value: "", label: "Создать новую" },
              ...(operations.data ?? []).map((o) => ({ value: o.id, label: o.name }))]}
          />

          <label>Цена для клиента за штуку (сум)</label>
          <input value={price} inputMode="numeric"
            onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))}
            placeholder="900000" />
          <div className="hint" style={{ marginTop: 6 }}>
            Её видит клиент в боте при оформлении заказа.
          </div>

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
      )}

      {kind === "materials" && (
        <>
          <label>Единица</label>
          <Select
            value={unit}
            onChange={(v) => setUnit(v as string)}
            title="Единица измерения"
            options={["шт", "м", "катушка", "пара", "уп", "кг"].map((u) => ({ value: u, label: u }))}
          />

          <label>Идёт на изделия <span className="hint">— можно несколько</span></label>
          <Select
            multiple
            value={garmentIds}
            onChange={(v) => setGarmentIds(v as unknown as string[])}
            title="Изделия"
            placeholder="Не привязано"
            options={(garments.data ?? []).map((g) => ({ value: g.id, label: g.name }))}
          />

          <label>Надбавка к цене за единицу (сум)</label>
          <input value={price} inputMode="numeric"
            onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))}
            placeholder="0" />
          <div className="hint" style={{ marginTop: 6 }}>
            Прибавляется к цене изделия, когда клиент выбирает этот материал.
          </div>

          <label>Минимальный остаток</label>
          <input value={minQty} inputMode="numeric"
            onChange={(e) => setMinQty(e.target.value.replace(/\D/g, ""))} />
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
  unit?: string; stock_qty?: number; short_name?: string | null; photo_url?: string | null;
  base_price_uzs?: number; price_per_unit_uzs?: number;
  agencies?: { name: string } | null;
  operations?: { name: string } | null;
}
