import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "../App";
import { db } from "../lib/api";
import { date, uzs } from "../lib/format";
import { confirm, haptic, tg } from "../lib/tg";

const STATUS = {
  assigned:    { label: "Назначена",   cls: "" },
  in_progress: { label: "В работе",    cls: "amber" },
  done:        { label: "Готово, ждёт ОТК", cls: "amber" },
  accepted:    { label: "Принята",     cls: "green" },
  rework:      { label: "Переделка",   cls: "red" },
} as const;

type Status = keyof typeof STATUS;

export default function Tasks() {
  const { me } = useApp();
  const qc = useQueryClient();
  const isMgr = me.role !== "seamstress";
  // Швея видит свою расценку (это её деньги), админ — всё.
  // Менеджеру суммы не показываем: зарплата — не его зона.
  const showMoney = me.role === "root_admin" || me.role === "seamstress";

  const tasks = useQuery({
    queryKey: ["tasks", me.id],
    queryFn: async () => {
      // RLS сама отдаст швее только её задачи — фильтр по assignee здесь не нужен
      const { data, error } = await db()
        .from("tasks")
        .select(`id,status,qty,rate_uzs,amount_uzs,deadline,instructions,rework_reason,
                 operations(name,unit),
                 order_items(garment_type,size_label,orders(number,title)),
                 staff:assignee_staff_id(full_name)`)
        .neq("status", "accepted")
        .order("deadline", { ascending: true, nullsFirst: false })
        .limit(100);
      if (error) throw error;
      return data as unknown as TaskRow[];
    },
  });

  const move = useMutation({
    mutationFn: async ({ id, status, reason }: { id: string; status: Status; reason?: string }) => {
      const { error } = await db().from("tasks")
        .update({ status, ...(reason ? { rework_reason: reason } : {}) }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { haptic("ok"); qc.invalidateQueries({ queryKey: ["tasks"] }); },
    onError: (e: Error) => { haptic("err"); tg().showAlert(e.message); },
  });

  return (
    <div className="page">
      <div className="h1">{isMgr ? "Задачи цеха" : "Мои задачи"}</div>

      {(tasks.data ?? []).map((t) => {
        const st = STATUS[t.status];
        const late = t.deadline && new Date(t.deadline) < new Date();
        return (
          <div className="card" key={t.id}>
            <div className="row">
              <div className="col" style={{ minWidth: 0 }}>
                <b>{t.operations?.name}</b>
                <span className="hint">
                  {t.order_items?.orders?.number} · {t.order_items?.garment_type}
                  {t.order_items?.size_label ? ` · ${t.order_items.size_label}` : ""}
                </span>
                {isMgr && <span className="hint">Исполнитель: {t.staff?.full_name ?? "не назначен"}</span>}
              </div>
              <span className={"badge " + st.cls}>{st.label}</span>
            </div>

            <div className="row" style={{ marginTop: 10 }}>
              <span className="hint">
                {t.qty} {t.operations?.unit}
                {showMoney && ` × ${uzs(t.rate_uzs)}`}
              </span>
              {showMoney && <b>{uzs(t.amount_uzs)}</b>}
            </div>

            {t.deadline && (
              <div className="hint" style={{ marginTop: 4, color: late ? "var(--danger)" : undefined }}>
                Срок: {date(t.deadline)}{late ? " — просрочено" : ""}
              </div>
            )}

            {t.instructions && (
              <div style={{ marginTop: 8, fontSize: 14, background: "var(--bg-sec)", padding: 10, borderRadius: 10 }}>
                {t.instructions}
              </div>
            )}

            {t.status === "rework" && t.rework_reason && (
              <div style={{ marginTop: 8, fontSize: 14, color: "var(--danger)" }}>
                Причина возврата: {t.rework_reason}
              </div>
            )}

            <Actions task={t} isMgr={isMgr} showMoney={showMoney} onMove={move.mutate} />
          </div>
        );
      })}

      {tasks.data?.length === 0 && <div className="empty">Активных задач нет</div>}
    </div>
  );
}

function Actions({ task, isMgr, showMoney, onMove }: {
  task: TaskRow;
  isMgr: boolean;
  showMoney: boolean;
  onMove: (v: { id: string; status: Status; reason?: string }) => void;
}) {
  const style = { display: "flex", gap: 8, marginTop: 12 };

  if (!isMgr) {
    if (task.status === "assigned" || task.status === "rework") {
      return <div style={style}><button onClick={() => onMove({ id: task.id, status: "in_progress" })}>Взять в работу</button></div>;
    }
    if (task.status === "in_progress") {
      return <div style={style}><button onClick={() => onMove({ id: task.id, status: "done" })}>Готово, сдать ОТК</button></div>;
    }
    return null;
  }

  // Деньги начисляются только здесь, при приёмке — не когда швея нажала «Готово».
  if (task.status === "done") {
    return (
      <div style={style}>
        <button onClick={async () => {
          const q = showMoney
            ? `Принять работу и начислить ${uzs(task.amount_uzs)}?`
            : "Принять работу? Начисление пройдёт автоматически.";
          if (await confirm(q)) {
            onMove({ id: task.id, status: "accepted" });
          }
        }}>Принять</button>
        <button className="danger" onClick={() => {
          const reason = prompt("Причина возврата на переделку:") ?? "";
          if (reason) onMove({ id: task.id, status: "rework", reason });
        }}>На переделку</button>
      </div>
    );
  }
  return null;
}

interface TaskRow {
  id: string;
  status: Status;
  qty: number;
  rate_uzs: number;
  amount_uzs: number;
  deadline: string | null;
  instructions: string | null;
  rework_reason: string | null;
  operations: { name: string; unit: string } | null;
  order_items: {
    garment_type: string;
    size_label: string | null;
    orders: { number: string; title: string } | null;
  } | null;
  staff: { full_name: string } | null;
}
