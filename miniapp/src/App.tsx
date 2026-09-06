import { createContext, useContext, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { Me, Settings, signIn } from "./lib/api";
import { diagnostics, getInitData, tg } from "./lib/tg";

import Home from "./screens/Home";
import Tasks from "./screens/Tasks";
import Earnings from "./screens/Earnings";
import Finance from "./screens/Finance";
import Payroll from "./screens/Payroll";
import Staff from "./screens/Staff";
import Supply from "./screens/Supply";
import Orders from "./screens/Orders";
import NewOrder from "./screens/NewOrder";
import Profile from "./screens/Profile";
import Catalog from "./screens/Catalog";

interface Ctx { me: Me; settings: Settings; initData: string }
const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => useContext(AppCtx)!;

export default function App() {
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const w = tg();
    w.ready();
    w.expand();
    w.disableVerticalSwipes?.();

    const initData = getInitData();
    if (!initData) {
      setError("Откройте приложение через бота @UniformaHubBot");
      return;
    }
    signIn(initData)
      .then(({ me, settings }) => setCtx({ me, settings, initData }))
      .catch((e: Error & { code?: string }) =>
        setError(e.code === "no_access"
          ? "Доступ не выдан. Обратитесь к администратору ателье."
          : e.message));
  }, []);

  if (error) {
    return (
      <div className="page">
        <div className="empty" style={{ paddingBottom: 16 }}>{error}</div>
        <div className="card">
          <div className="stat-label" style={{ marginBottom: 8 }}>Диагностика</div>
          {Object.entries(diagnostics()).map(([k, v]) => (
            <div className="row" key={k} style={{ fontSize: 13, padding: "3px 0" }}>
              <span className="hint">{k}</span>
              <span style={{ textAlign: "right", wordBreak: "break-all" }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (!ctx) return <div className="empty">Загрузка…</div>;

  const role = ctx.me.role;
  const isRoot = role === "root_admin";
  const isMgr = role === "manager" || isRoot;

  return (
    <AppCtx.Provider value={ctx}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/profile" element={<Profile />} />
        {!isMgr && <Route path="/earnings" element={<Earnings />} />}
        {isMgr && <Route path="/orders" element={<Orders />} />}
        {isMgr && <Route path="/orders/new" element={<NewOrder />} />}
        {isMgr && <Route path="/supply" element={<Supply />} />}
        {isRoot && <Route path="/finance" element={<Finance />} />}
        {isRoot && <Route path="/payroll" element={<Payroll />} />}
        {isRoot && <Route path="/staff" element={<Staff />} />}
        {isRoot && <Route path="/catalog/:kind" element={<Catalog />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <TabBar role={role} />
    </AppCtx.Provider>
  );
}

function TabBar({ role }: { role: Me["role"] }) {
  const nav = useNavigate();
  const canCreate = role !== "seamstress";

  // Финансы, зарплата, закуп и справочники живут в «Профиле»:
  // в нижней панели должно остаться только ежедневное.
  const tabs = role === "seamstress"
    ? [["/", "🏠", "Главная"], ["/tasks", "📋", "Задачи"],
       ["/earnings", "💰", "Заработок"], ["/profile", "👤", "Профиль"]]
    : [["/", "🏠", "Главная"], ["/orders", "📦", "Заказы"],
       ["/tasks", "🧑‍🏭", "Задачи"], ["/profile", "👤", "Профиль"]];

  // Кнопка «+» стоит в центре: это самое частое действие,
  // и большим пальцем до середины экрана дотянуться проще всего.
  const half = Math.ceil(tabs.length / 2);
  const left = canCreate ? tabs.slice(0, half) : tabs;
  const right = canCreate ? tabs.slice(half) : [];

  const link = ([to, ico, label]: string[]) => (
    <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => (isActive ? "on" : "")}>
      <span className="ico">{ico}</span>
      {label}
    </NavLink>
  );

  return (
    <nav className="tabbar">
      {left.map(link)}
      {canCreate && (
        <div className="fab-slot" onClick={() => nav("/orders/new")}>
          <button className="fab" aria-label="Новый заказ">+</button>
          <span className="fab-label">Заказ</span>
        </div>
      )}
      {right.map(link)}
    </nav>
  );
}
