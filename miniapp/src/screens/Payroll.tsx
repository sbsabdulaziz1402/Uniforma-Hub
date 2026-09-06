import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import FinanceGate from "../components/FinanceGate";
import { db } from "../lib/api";
import { dateTime, uzs } from "../lib/format";
import { haptic, tg } from "../lib/tg";
import Select from "../components/Select";

export default function Payroll() {
  return <FinanceGate><Board /></FinanceGate>;
}

function Board() {
  const qc = useQueryClient();
  const [payTo, setPayTo] = useState<{ id: string; name: string; balance: number } | null>(null);

  const rows = useQuery({
    queryKey: ["payroll"],
    queryFn: async () => {
      const { data, error } = await db()
        .from("v_staff_balance")
        .select("staff_id,full_name,role,earned_uzs,paid_uzs,balance_uzs,last_payment_at")
        .neq("role", "root_admin")
        .order("balance_uzs", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const total = (rows.data ?? []).reduce((s, r) => s + Number(r.balance_uzs), 0);

  if (payTo) return <PayForm target={payTo} onDone={() => { setPayTo(null); qc.invalidateQueries(); }} />;

  return (
    <div className="page">
      <div className="h1">Зарплата</div>

      <div className="card">
        <div className="stat-label">Всего к выплате</div>
        <div className="stat">{uzs(total)}</div>
      </div>

      {(rows.data ?? []).map((r) => (
        <div className="card" key={r.staff_id}>
          <div className="row">
            <div className="col" style={{ minWidth: 0 }}>
              <b>{r.full_name}</b>
              <span className="hint">
                начислено {uzs(r.earned_uzs)} · выплачено {uzs(r.paid_uzs)}
              </span>
              <span className="hint">последняя выплата: {dateTime(r.last_payment_at)}</span>
            </div>
            <b style={{ whiteSpace: "nowrap", color: Number(r.balance_uzs) > 0 ? "var(--text)" : "var(--hint)" }}>
              {uzs(r.balance_uzs)}
            </b>
          </div>
          {Number(r.balance_uzs) > 0 && (
            <button style={{ marginTop: 10 }} onClick={() => {
              haptic();
              setPayTo({ id: r.staff_id, name: r.full_name, balance: Number(r.balance_uzs) });
            }}>Выплатить</button>
          )}
        </div>
      ))}
    </div>
  );
}

function PayForm({ target, onDone }: {
  target: { id: string; name: string; balance: number };
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(String(target.balance));
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");

  // Выплата автоматически создаёт расход в transactions (триггер в БД),
  // поэтому отдельно проводить её в финансах не нужно.
  const pay = useMutation({
    mutationFn: async () => {
      const v = Number(amount.replace(/\D/g, ""));
      if (!v || v <= 0) throw new Error("Введите сумму");
      const { error } = await db().from("payroll_payments")
        .insert({ staff_id: target.id, amount_uzs: v, method, note: note || null });
      if (error) throw error;
    },
    onSuccess: () => { haptic("ok"); onDone(); },
    onError: (e: Error) => { haptic("err"); tg().showAlert(e.message); },
  });

  return (
    <div className="page">
      <div className="h1">Выплата: {target.name}</div>
      <div className="hint">К выплате по балансу: {uzs(target.balance)}</div>

      <label>Сумма (сум)</label>
      <input value={amount} inputMode="numeric"
        onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="chip" onClick={() => setAmount(String(target.balance))}>Весь остаток</button>
        <button className="chip" onClick={() => setAmount(String(Math.round(target.balance / 2)))}>Половина</button>
      </div>

      <label>Способ</label>
      <Select
        value={method}
        onChange={(v) => setMethod(v as string)}
        title="Способ выплаты"
        options={[
          { value: "cash", label: "Наличные" },
          { value: "card", label: "Карта" },
          { value: "transfer", label: "Перечисление" },
        ]}
      />

      <label>Комментарий</label>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="аванс за сентябрь" />

      <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
        <button className="ghost" onClick={onDone}>Отмена</button>
        <button onClick={() => pay.mutate()} disabled={pay.isPending}>Провести выплату</button>
      </div>
    </div>
  );
}
