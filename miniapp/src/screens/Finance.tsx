import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import FinanceGate from "../components/FinanceGate";
import { db } from "../lib/api";
import { dateTime, uzs, uzsShort } from "../lib/format";

type Period = "week" | "month" | "quarter";

function range(p: Period) {
  const to = new Date();
  const from = new Date();
  if (p === "week") from.setDate(to.getDate() - 7);
  if (p === "month") from.setMonth(to.getMonth() - 1);
  if (p === "quarter") from.setMonth(to.getMonth() - 3);
  from.setHours(0, 0, 0, 0);
  return { from: from.toISOString(), to: to.toISOString() };
}

export default function Finance() {
  return <FinanceGate><Report /></FinanceGate>;
}

function Report() {
  const [period, setPeriod] = useState<Period>("month");
  const { from, to } = useMemo(() => range(period), [period]);

  const summary = useQuery({
    queryKey: ["fin-summary", period],
    queryFn: async () => {
      const { data, error } = await db().rpc("finance_summary", { p_from: from, p_to: to });
      if (error) throw error;
      return data[0] as { income_uzs: number; expense_uzs: number; profit_uzs: number };
    },
  });

  const daily = useQuery({
    queryKey: ["fin-daily", period],
    queryFn: async () => {
      const { data, error } = await db().rpc("finance_daily", { p_from: from, p_to: to });
      if (error) throw error;
      return data as { day: string; income_uzs: number; expense_uzs: number }[];
    },
  });

  const txns = useQuery({
    queryKey: ["fin-txns", period],
    queryFn: async () => {
      const { data, error } = await db()
        .from("transactions")
        .select("id,type,category,amount_uzs,occurred_at,counterparty,note")
        .gte("occurred_at", from).lt("occurred_at", to)
        .order("occurred_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data;
    },
  });

  const s = summary.data;
  const max = Math.max(1, ...(daily.data ?? []).flatMap((d) => [d.income_uzs, d.expense_uzs]));

  return (
    <div className="page">
      <div className="h1">Расходы и прибыль</div>

      <div className="chips">
        {([["week", "Неделя"], ["month", "Месяц"], ["quarter", "Квартал"]] as const).map(([k, l]) => (
          <button key={k} className={"chip" + (period === k ? " active" : "")} onClick={() => setPeriod(k)}>
            {l}
          </button>
        ))}
      </div>

      <div className="card">
        <div className="stat-label">Прибыль</div>
        <div className="stat" style={{ color: (s?.profit_uzs ?? 0) >= 0 ? "var(--success)" : "var(--danger)" }}>
          {summary.isLoading ? "…" : uzs(s?.profit_uzs)}
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <div className="col">
            <span className="stat-label">Доход</span>
            <span className="stat income" style={{ fontSize: 18 }}>{uzsShort(s?.income_uzs)}</span>
          </div>
          <div className="col" style={{ alignItems: "flex-end" }}>
            <span className="stat-label">Расход</span>
            <span className="stat expense" style={{ fontSize: 18 }}>{uzsShort(s?.expense_uzs)}</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="stat-label">По дням</div>
        <div className="bar-chart">
          {(daily.data ?? []).map((d) => (
            <div className="bar-col" key={d.day} title={d.day}>
              <div className="bar income"  style={{ height: `${(d.income_uzs / max) * 55}%` }} />
              <div className="bar expense" style={{ height: `${(d.expense_uzs / max) * 55}%` }} />
            </div>
          ))}
        </div>
        <div className="hint" style={{ marginTop: 6 }}>зелёный — доход, красный — расход</div>
      </div>

      <div className="stat-label" style={{ margin: "16px 0 8px" }}>Операции</div>
      {(txns.data ?? []).map((t) => (
        <div className="card" key={t.id} style={{ padding: "10px 14px" }}>
          <div className="row">
            <div className="col" style={{ minWidth: 0 }}>
              <b style={{ fontSize: 15 }}>{t.category}</b>
              <span className="hint" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t.counterparty ?? t.note ?? ""} · {dateTime(t.occurred_at)}
              </span>
            </div>
            <b style={{ color: t.type === "income" ? "var(--success)" : "var(--danger)", whiteSpace: "nowrap" }}>
              {t.type === "income" ? "+" : "−"}{uzsShort(t.amount_uzs)}
            </b>
          </div>
        </div>
      ))}
      {txns.data?.length === 0 && <div className="empty">За период операций нет</div>}
    </div>
  );
}
