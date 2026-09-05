import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "../lib/api";
import { date } from "../lib/format";
import { haptic, tg } from "../lib/tg";

// Пайплайн заказа. Порядок здесь = порядок в цеху, менять осторожно.
const PIPELINE = [
  ["new", "Новый"],
  ["measuring", "Замеры"],
  ["fitting", "Примерка"],
  ["production", "Пошив"],
  ["qc", "ОТК"],
  ["ready", "Готов"],
  ["delivered", "Выдан"],
] as const;

const LABEL = Object.fromEntries(PIPELINE) as Record<string, string>;

export default function Orders() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>("active");

  const orders = useQuery({
    queryKey: ["orders", filter],
    queryFn: async () => {
      let q = db().from("orders")
        .select("id,number,title,status,deadline,clients(short_name,name),order_items(qty,total_uzs)")
        .order("deadline", { ascending: true, nullsFirst: false }).limit(100);
      if (filter === "active") q = q.not("status", "in", "(delivered,cancelled)");
      else if (filter !== "all") q = q.eq("status", filter);
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as Row[];
    },
  });

  const advance = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await db().from("orders").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { haptic("ok"); qc.invalidateQueries({ queryKey: ["orders"] }); },
    onError: (e: Error) => tg().showAlert(e.message),
  });

  return (
    <div className="page">
      <div className="h1">Заказы</div>

      <div className="chips">
        <button className={"chip" + (filter === "active" ? " active" : "")} onClick={() => setFilter("active")}>
          В работе
        </button>
        {PIPELINE.map(([k, l]) => (
          <button key={k} className={"chip" + (filter === k ? " active" : "")} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>

      {(orders.data ?? []).map((o) => {
        const items = o.order_items ?? [];
        const qty = items.reduce((s, i) => s + i.qty, 0);
        const idx = PIPELINE.findIndex(([k]) => k === o.status);
        const next = PIPELINE[idx + 1];
        const late = o.deadline && new Date(o.deadline) < new Date() && o.status !== "delivered";

        return (
          <div className="card" key={o.id}>
            <div className="row">
              <div className="col" style={{ minWidth: 0 }}>
                <b>{o.number} · {o.title}</b>
                <span className="hint">{o.clients?.short_name ?? o.clients?.name}</span>
                <span className="hint" style={{ color: late ? "var(--danger)" : undefined }}>
                  {qty} изд. · срок {date(o.deadline)}{late ? " — просрочено" : ""}
                </span>
              </div>
              <span className="badge">{LABEL[o.status] ?? o.status}</span>
            </div>

            {next && (
              <button className="ghost" style={{ marginTop: 10 }}
                onClick={() => advance.mutate({ id: o.id, status: next[0] })}>
                Перевести в «{next[1]}»
              </button>
            )}
          </div>
        );
      })}

      {orders.data?.length === 0 && <div className="empty">Заказов нет</div>}
    </div>
  );
}

interface Row {
  id: string; number: string; title: string; status: string; deadline: string | null;
  clients: { short_name: string | null; name: string } | null;
  order_items: { qty: number; total_uzs: number }[] | null;
}
