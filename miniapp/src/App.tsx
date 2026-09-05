import { createContext, useContext, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { Me, Settings, signIn } from "./lib/api";
import { tg } from "./lib/tg";

import Home from "./screens/Home";
import Tasks from "./screens/Tasks";
import Earnings from "./screens/Earnings";
import Finance from "./screens/Finance";
import Payroll from "./screens/Payroll";
import Staff from "./screens/Staff";
import Supply from "./screens/Supply";
import Orders from "./screens/Orders";

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

    const initData = w.initData;
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

  if (error) return <div className="empty">{error}</div>;
  if (!ctx) return <div className="empty">Загрузка…</div>;

  const role = ctx.me.role;
  const isRoot = role === "root_admin";
  const isMgr = role === "manager" || isRoot;

  return (
    <AppCtx.Provider value={ctx}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/tasks" element={<Tasks />} />
        {!isMgr && <Route path="/earnings" element={<Earnings />} />}
        {isMgr && <Route path="/orders" element={<Orders />} />}
        {isMgr && <Route path="/supply" element={<Supply />} />}
        {isRoot && <Route path="/finance" element={<Finance />} />}
        {isRoot && <Route path="/payroll" element={<Payroll />} />}
        {isRoot && <Route path="/staff" element={<Staff />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <TabBar role={role} />
    </AppCtx.Provider>
  );
}

function TabBar({ role }: { role: Me["role"] }) {
  const tabs = role === "seamstress"
    ? [["/", "🏠", "Главная"], ["/tasks", "📋", "Задачи"], ["/earnings", "💰", "Заработок"]]
    : role === "manager"
    ? [["/", "🏠", "Главная"], ["/orders", "📦", "Заказы"], ["/tasks", "🧑‍🏭", "Задачи"], ["/supply", "🛒", "Закуп"]]
    : [["/", "🏠", "Главная"], ["/orders", "📦", "Заказы"], ["/finance", "📊", "Финансы"],
       ["/payroll", "💵", "Зарплата"], ["/staff", "👥", "Люди"]];

  return (
    <nav className="tabbar">
      {tabs.map(([to, ico, label]) => (
        <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => (isActive ? "on" : "")}>
          <span className="ico">{ico}</span>
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
