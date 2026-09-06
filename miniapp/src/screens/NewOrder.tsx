import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "../lib/api";
import { phoneMask, toE164 } from "../lib/format";
import { haptic, tg } from "../lib/tg";
import Select from "../components/Select";

interface Client { id: string; name: string; phone: string | null; agency: string | null }

/**
 * Новый заказ в четыре шага: клиент → изделие → материал → швея.
 * Цену здесь не спрашиваем: суммы проставляет администратор,
 * это ограничение стоит и в БД (триггер guard_item_price).
 */
export default function NewOrder() {
  const nav = useNavigate();
  const qc = useQueryClient();

  const [phone, setPhone] = useState("+998 ");
  const [name, setName] = useState("");
  const [agency, setAgency] = useState("");
  const [existing, setExisting] = useState<Client | null>(null);

  const [garmentId, setGarmentId] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [seamstressId, setSeamstressId] = useState("");
  const [qty, setQty] = useState("1");
  const [deadline, setDeadline] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const digits = phone.replace(/\D/g, "");

  // Подсказки под полем телефона — с 3-й цифры, чтобы не тянуть всю базу
  const suggestions = useQuery({
    queryKey: ["client-search", digits],
    enabled: digits.length >= 6 && !existing,
    queryFn: async () => {
      const { data, error } = await db()
        .from("clients")
        .select("id,name,phone,agency")
        .ilike("phone", `+${digits}%`)
        .limit(5);
      if (error) throw error;
      return data as Client[];
    },
  });

  const garments = useQuery({
    queryKey: ["garments"],
    queryFn: async () => {
      const { data, error } = await db()
        .from("garment_types").select("id,name,default_operation_id")
        .eq("is_active", true).order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const materials = useQuery({
    queryKey: ["materials-list"],
    queryFn: async () => {
      const { data, error } = await db()
        .from("materials").select("id,name,unit").eq("is_active", true).order("name");
      if (error) throw error;
      return data;
    },
  });

  const seamstresses = useQuery({
    queryKey: ["seamstresses"],
    queryFn: async () => {
      const { data, error } = await db()
        .from("staff").select("id,full_name")
        .eq("role", "seamstress").eq("is_active", true)
        .is("archived_at", null).order("full_name");
      if (error) throw error;
      return data;
    },
  });

  // Автозаполнение при выборе существующего клиента
  const pick = (c: Client) => {
    haptic();
    setExisting(c);
    setPhone(phoneMask(c.phone ?? ""));
    setName(c.name);
    setAgency(c.agency ?? "");
  };

  // Правка телефона отменяет привязку к найденному клиенту
  useEffect(() => {
    if (existing && toE164(phone) !== existing.phone) setExisting(null);
  }, [phone, existing]);

  const garment = useMemo(
    () => garments.data?.find((g) => g.id === garmentId),
    [garments.data, garmentId],
  );

  const create = useMutation({
    mutationFn: async () => {
      const e164 = toE164(phone);
      if (e164.length !== 13) throw new Error("Введите номер полностью");
      if (name.trim().length < 3) throw new Error("Укажите имя клиента");
      if (!garmentId) throw new Error("Выберите изделие");
      const n = Number(qty);
      if (!n || n < 1) throw new Error("Количество — целое число от 1");

      // 1. клиент: берём найденного или заводим нового
      let clientId = existing?.id;
      if (!clientId) {
        const { data, error } = await db().from("clients")
          .insert({ name: name.trim(), phone: e164, agency: agency.trim() || null })
          .select("id").single();
        if (error) throw error;
        clientId = data.id;
      }

      // 2. заказ
      const { data: order, error: oErr } = await db().from("orders")
        .insert({
          client_id: clientId,
          title: `${garment?.name} — ${n} шт`,
          deadline: deadline || null,
        })
        .select("id,number").single();
      if (oErr) throw oErr;

      // 3. позиция (цену не ставим — её проставляет администратор)
      const { data: item, error: iErr } = await db().from("order_items")
        .insert({
          order_id: order.id,
          garment_type: garment!.name,
          qty: n,
          material_id: materialId || null,
        })
        .select("id").single();
      if (iErr) throw iErr;

      // 4. задача швее, если выбрана
      if (seamstressId && garment?.default_operation_id) {
        const { data: op } = await db().from("operations")
          .select("default_rate_uzs").eq("id", garment.default_operation_id).single();
        const { error: tErr } = await db().from("tasks").insert({
          order_item_id: item.id,
          operation_id: garment.default_operation_id,
          assignee_staff_id: seamstressId,
          qty: n,
          rate_uzs: op?.default_rate_uzs ?? 0,
          deadline: deadline || null,
        });
        if (tErr) throw tErr;
      }

      return order.number as string;
    },
    onSuccess: (number) => {
      haptic("ok");
      qc.invalidateQueries();
      tg().showAlert(`Заказ ${number} создан`, () => nav("/orders"));
    },
    onError: (e: Error) => { haptic("err"); setErr(e.message); },
  });

  return (
    <div className="page">
      <div className="h1">Новый заказ</div>
      <div className="sub">Найдите клиента по номеру или заведите нового</div>

      {/* --- Клиент --- */}
      <label>Телефон клиента</label>
      <div className="field"><span className="ico-l">📞</span><input
        value={phone}
        inputMode="numeric"
        onChange={(e) => setPhone(phoneMask(e.target.value))}
        placeholder="+998 90 123 45 67"
      /></div>

      {!existing && (suggestions.data?.length ?? 0) > 0 && (
        <div className="card" style={{ marginTop: 6, padding: 4 }}>
          {suggestions.data!.map((c) => (
            <button key={c.id} className="ghost" style={{ textAlign: "left", padding: "10px 12px" }}
              onClick={() => pick(c)}>
              <div style={{ fontWeight: 600 }}>{c.name}</div>
              <div className="hint">{c.phone}{c.agency ? ` · ${c.agency}` : ""}</div>
            </button>
          ))}
        </div>
      )}

      {existing && (
        <div className="hint" style={{ marginTop: 6, color: "var(--success)" }}>
          Клиент найден в базе — поля заполнены автоматически
        </div>
      )}

      <label>Имя клиента</label>
      <div className="field"><span className="ico-l">👤</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Азиз Каримов" /></div>

      <label>Орган / ведомство <span className="hint">— необязательно</span></label>
      <div className="field"><span className="ico-l">🏛</span><input value={agency} onChange={(e) => setAgency(e.target.value)} placeholder="ГУВД г. Ташкента" /></div>

      {/* --- Изделие --- */}
      <label>Изделие</label>
      <div className="chips" style={{ flexWrap: "wrap", overflow: "visible" }}>
        {(garments.data ?? []).map((g) => (
          <button key={g.id} className={"chip" + (garmentId === g.id ? " active" : "")}
            onClick={() => { haptic(); setGarmentId(g.id); }}>
            {g.name}
          </button>
        ))}
      </div>

      <label>Количество</label>
      <div className="field"><span className="ico-l">№</span><input value={qty} inputMode="numeric"
        onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} /></div>

      {/* --- Материал --- */}
      <label>Материал <span className="hint">— необязательно</span></label>
      <Select
        value={materialId}
        onChange={(v) => setMaterialId(v as string)}
        title="Материал"
        placeholder="Не выбран"
        options={[{ value: "", label: "Не выбран" },
          ...(materials.data ?? []).map((m) => ({ value: m.id, label: m.name, note: m.unit }))]}
      />

      {/* --- Швея --- */}
      <label>Швея <span className="hint">— можно назначить позже</span></label>
      <Select
        value={seamstressId}
        onChange={(v) => setSeamstressId(v as string)}
        title="Швея"
        placeholder="Не назначена"
        options={[{ value: "", label: "Не назначена" },
          ...(seamstresses.data ?? []).map((s) => ({ value: s.id, label: s.full_name }))]}
      />

      <label>Срок сдачи</label>
      <div className="field"><span className="ico-l">📅</span><input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></div>

      {err && <div style={{ color: "var(--danger)", marginTop: 12, fontSize: 14 }}>{err}</div>}

      <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
        <button className="ghost" onClick={() => nav(-1)}>Отмена</button>
        <button onClick={() => create.mutate()} disabled={create.isPending}>
          {create.isPending ? "Создаём…" : "Создать заказ"}
        </button>
      </div>
    </div>
  );
}
