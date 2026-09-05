import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useApp } from "../App";
import { db } from "../lib/api";
import { uzs } from "../lib/format";

export default function Home() {
  const { me } = useApp();

  const stats = useQuery({
    queryKey: ["home", me.role],
    queryFn: async () => {
      const [tasks, orders, supply, balance] = await Promise.all([
        db().from("tasks").select("id", { count: "exact", head: true }).not("status", "in", "(accepted)"),
        db().from("orders").select("id", { count: "exact", head: true }).not("status", "in", "(delivered,cancelled)"),
        db().from("supply_requests").select("id", { count: "exact", head: true }).eq("status", "new"),
        me.role === "seamstress"
          ? db().from("v_staff_balance").select("balance_uzs").eq("staff_id", me.id).single()
          : Promise.resolve({ data: null }),
      ]);
      return {
        tasks: tasks.count ?? 0,
        orders: orders.count ?? 0,
        supply: supply.count ?? 0,
        balance: (balance as { data: { balance_uzs: number } | null }).data?.balance_uzs ?? null,
      };
    },
  });

  const s = stats.data;

  return (
    <div className="page">
      <div className="h1">Здравствуйте, {me.full_name.split(" ")[0]}</div>

      {me.role === "seamstress" ? (
        <>
          <Link to="/earnings" style={{ textDecoration: "none", color: "inherit" }}>
            <div className="card">
              <div className="stat-label">К выплате</div>
              <div className="stat">{s ? uzs(s.balance) : "…"}</div>
            </div>
          </Link>
          <Link to="/tasks" style={{ textDecoration: "none", color: "inherit" }}>
            <div className="card">
              <div className="row">
                <b>Мои задачи</b>
                <span className="badge amber">{s?.tasks ?? "…"}</span>
              </div>
            </div>
          </Link>
          <div className="card">
            <b>Нужны материалы?</b>
            <div className="hint" style={{ marginTop: 4 }}>
              Заявку на закуп удобнее оставить прямо в чате с ботом — кнопка «🧵 Добавить в закуп».
            </div>
          </div>
        </>
      ) : (
        <>
          <Link to="/orders" style={{ textDecoration: "none", color: "inherit" }}>
            <div className="card"><div className="row"><b>Заказы в работе</b><span className="badge">{s?.orders ?? "…"}</span></div></div>
          </Link>
          <Link to="/tasks" style={{ textDecoration: "none", color: "inherit" }}>
            <div className="card"><div className="row"><b>Незакрытые задачи</b><span className="badge amber">{s?.tasks ?? "…"}</span></div></div>
          </Link>
          <Link to="/supply" style={{ textDecoration: "none", color: "inherit" }}>
            <div className="card"><div className="row"><b>Заявки на закуп</b><span className="badge">{s?.supply ?? "…"}</span></div></div>
          </Link>
          {me.role === "root_admin" && (
            <Link to="/finance" style={{ textDecoration: "none", color: "inherit" }}>
              <div className="card">
                <div className="row"><b>📊 Расходы и прибыль</b><span className="hint">по PIN-коду</span></div>
              </div>
            </Link>
          )}
        </>
      )}
    </div>
  );
}
