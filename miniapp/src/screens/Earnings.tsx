import { useQuery } from "@tanstack/react-query";
import { useApp } from "../App";
import { db } from "../lib/api";
import { dateTime, uzs } from "../lib/format";

/**
 * «Мой заработок» для швеи.
 * Открытая цифра снимает большую часть споров о зарплате: швея видит
 * остаток в любой момент, а не раз в месяц на бумажке.
 */
export default function Earnings() {
  const { me } = useApp();

  const balance = useQuery({
    queryKey: ["balance", me.id],
    queryFn: async () => {
      const { data, error } = await db()
        .from("v_staff_balance")
        .select("earned_uzs,paid_uzs,balance_uzs")
        .eq("staff_id", me.id).single();
      if (error) throw error;
      return data;
    },
  });

  const accruals = useQuery({
    queryKey: ["accruals", me.id],
    queryFn: async () => {
      const { data, error } = await db()
        .from("payroll_accruals")
        .select("id,type,amount_uzs,note,accrued_at")
        .order("accrued_at", { ascending: false }).limit(50);
      if (error) throw error;
      return data;
    },
  });

  const payments = useQuery({
    queryKey: ["payments", me.id],
    queryFn: async () => {
      const { data, error } = await db()
        .from("payroll_payments")
        .select("id,amount_uzs,method,paid_at")
        .order("paid_at", { ascending: false }).limit(20);
      if (error) throw error;
      return data;
    },
  });

  const b = balance.data;

  return (
    <div className="page">
      <div className="h1">Мой заработок</div>

      <div className="card">
        <div className="stat-label">К выплате</div>
        <div className="stat">{balance.isLoading ? "…" : uzs(b?.balance_uzs)}</div>
        <div className="row" style={{ marginTop: 14 }}>
          <div className="col">
            <span className="stat-label">Начислено</span>
            <b>{uzs(b?.earned_uzs)}</b>
          </div>
          <div className="col" style={{ alignItems: "flex-end" }}>
            <span className="stat-label">Получено</span>
            <b>{uzs(b?.paid_uzs)}</b>
          </div>
        </div>
      </div>

      <div className="stat-label" style={{ margin: "16px 0 8px" }}>Начисления</div>
      {(accruals.data ?? []).map((a) => (
        <div className="card" key={a.id} style={{ padding: "10px 14px" }}>
          <div className="row">
            <div className="col" style={{ minWidth: 0 }}>
              <b style={{ fontSize: 15 }}>
                {a.type === "piece" ? "Принятая задача"
                  : a.type === "bonus" ? "Премия"
                  : a.type === "penalty" ? "Удержание" : "Оклад"}
              </b>
              <span className="hint">{a.note ?? ""} · {dateTime(a.accrued_at)}</span>
            </div>
            <b style={{ color: a.amount_uzs < 0 ? "var(--danger)" : "var(--success)", whiteSpace: "nowrap" }}>
              {a.amount_uzs < 0 ? "" : "+"}{uzs(a.amount_uzs)}
            </b>
          </div>
        </div>
      ))}
      {accruals.data?.length === 0 && <div className="empty">Пока нет начислений</div>}

      <div className="stat-label" style={{ margin: "16px 0 8px" }}>Выплаты</div>
      {(payments.data ?? []).map((p) => (
        <div className="card" key={p.id} style={{ padding: "10px 14px" }}>
          <div className="row">
            <span className="hint">{dateTime(p.paid_at)} · {
              p.method === "cash" ? "наличные" : p.method === "card" ? "карта" : "перечисление"
            }</span>
            <b>{uzs(p.amount_uzs)}</b>
          </div>
        </div>
      ))}
      {payments.data?.length === 0 && <div className="empty">Выплат ещё не было</div>}
    </div>
  );
}
