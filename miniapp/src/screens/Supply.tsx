import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "../lib/api";
import { uzs } from "../lib/format";
import { haptic, tg } from "../lib/tg";

const URGENCY = {
  blocking: { icon: "🔴", label: "Стоит работа", cls: "red" },
  week:     { icon: "🟡", label: "На неделе",    cls: "amber" },
  stock:    { icon: "⚪", label: "Про запас",    cls: "" },
} as const;

/**
 * Сводный список закупа: одинаковые позиции от разных швей
 * схлопнуты в одну строку представлением v_supply_board.
 */
export default function Supply() {
  const qc = useQueryClient();
  const [buying, setBuying] = useState<Row | null>(null);

  const board = useQuery({
    queryKey: ["supply"],
    queryFn: async () => {
      const { data, error } = await db()
        .from("v_supply_board")
        .select("*")
        .order("urgency").order("first_requested_at");
      if (error) throw error;
      return data as Row[];
    },
  });

  if (buying) return <BuyForm row={buying} onDone={() => { setBuying(null); qc.invalidateQueries(); }} />;

  return (
    <div className="page">
      <div className="h1">Список закупа</div>
      <div className="hint" style={{ marginBottom: 12 }}>
        Заявки от швей. Расход в финансах появится только после отметки о покупке.
      </div>

      {(board.data ?? []).map((r) => {
        const u = URGENCY[r.urgency];
        return (
          <div className="card" key={r.item_key}>
            <div className="row">
              <div className="col" style={{ minWidth: 0 }}>
                <b>{u.icon} {r.item_name}</b>
                <span className="hint">{r.requested_by.join(", ")}</span>
              </div>
              <div className="col" style={{ alignItems: "flex-end" }}>
                <b style={{ whiteSpace: "nowrap" }}>{r.total_qty} {r.unit}</b>
                <span className={"badge " + u.cls}>{u.label}</span>
              </div>
            </div>
            <button style={{ marginTop: 10 }} onClick={() => { haptic(); setBuying(r); }}>
              Отметить купленным
            </button>
          </div>
        );
      })}

      {board.data?.length === 0 && <div className="empty">Заявок нет</div>}
    </div>
  );
}

function BuyForm({ row, onDone }: { row: Row; onDone: () => void }) {
  const [cost, setCost] = useState("");
  const [qty, setQty] = useState(String(row.total_qty));

  const buy = useMutation({
    mutationFn: async () => {
      const total = Number(cost.replace(/\D/g, ""));
      if (!total) throw new Error("Введите фактическую сумму покупки");

      // Сумму делим между заявками пропорционально, остаток от деления
      // кладём в первую — иначе копейки сумм разойдутся с расходом.
      const n = row.request_ids.length;
      const per = Math.floor(total / n);
      const rest = total - per * n;

      const updates = row.request_ids.map((id, i) => db().from("supply_requests").update({
        status: "purchased",
        purchased_qty: Number(qty) / n,
        purchased_cost_uzs: per + (i === 0 ? rest : 0),
        decided_at: new Date().toISOString(),
      }).eq("id", id));

      const results = await Promise.all(updates);
      const failed = results.find((r) => r.error);
      if (failed?.error) throw failed.error;
    },
    onSuccess: () => { haptic("ok"); onDone(); },
    onError: (e: Error) => { haptic("err"); tg().showAlert(e.message); },
  });

  return (
    <div className="page">
      <div className="h1">{row.item_name}</div>

      <label>Сколько куплено ({row.unit})</label>
      <input value={qty} inputMode="decimal" onChange={(e) => setQty(e.target.value)} />

      <label>Фактическая сумма (сум)</label>
      <input value={cost} inputMode="numeric"
        onChange={(e) => setCost(e.target.value.replace(/\D/g, ""))} placeholder="например 450000" />
      <div className="hint" style={{ marginTop: 4 }}>
        Пойдёт в расходы категории «Материалы»: {cost ? uzs(Number(cost)) : "—"}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
        <button className="ghost" onClick={onDone}>Отмена</button>
        <button onClick={() => buy.mutate()} disabled={buy.isPending}>Провести покупку</button>
      </div>
    </div>
  );
}

interface Row {
  item_key: string;
  item_name: string;
  unit: string;
  urgency: keyof typeof URGENCY;
  total_qty: number;
  requests_count: number;
  requested_by: string[];
  request_ids: string[];
  first_requested_at: string;
}
