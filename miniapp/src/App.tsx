import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { Me, Settings, signIn, signInWidget, storedWidgetAuth } from "./lib/api";
import { getInitData, tg } from "./lib/tg";
import TelegramLogin from "./components/TelegramLogin";

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
import NewSupply from "./screens/NewSupply";

interface Ctx { me: Me; settings: Settings; initData: string }
const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => useContext(AppCtx)!;

export default function App() {
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needLogin, setNeedLogin] = useState(false);

  const accept = useCallback((me: Me, settings: Settings, initData: string) => {
    setCtx({ me, settings, initData });
    setNeedLogin(false);
    setError(null);
  }, []);

  const fail = useCallback((e: Error & { code?: string }) => {
    setError(e.code === "no_access"
      ? "Доступ не выдан. Обратитесь к администратору ателье."
      : e.message);
  }, []);

  useEffect(() => {
    const w = tg();
    w.ready();
    w.expand();
    w.disableVerticalSwipes?.();

    const initData = getInitData();
    if (initData) {
      signIn(initData).then(({ me, settings }) => accept(me, settings, initData)).catch(fail);
      return;
    }

    // Браузер: initData нет. Пробуем сохранённый вход, иначе показываем кнопку.
    const saved = storedWidgetAuth();
    if (saved) {
      signInWidget(saved)
        .then(({ me, settings }) => accept(me, settings, ""))
        .catch(() => setNeedLogin(true));
    } else {
      setNeedLogin(true);
    }
  }, [accept, fail]);

  if (needLogin) {
    return (
      <div className="page" style={{ maxWidth: 420, paddingTop: "18vh" }}>
        <div className="h1">Uniforma Hub</div>
        <div className="sub">
          Войдите через Telegram — тем же аккаунтом, чей номер внесён в список сотрудников.
        </div>
        <div className="card" style={{ padding: 24 }}>
          <TelegramLogin onAuth={(user) => {
            signInWidget(user).then(({ me, settings }) => accept(me, settings, "")).catch(fail);
          }} />
        </div>
        {error && (
          <div style={{ color: "var(--danger)", fontSize: 14, textAlign: "center" }}>{error}</div>
        )}
        <div className="hint" style={{ textAlign: "center", marginTop: 18 }}>
          В Telegram приложение открывается кнопкой «Открыть» слева от поля ввода.
        </div>
      </div>
    );
  }

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
        <Route path="/profile" element={<Profile />} />
        <Route path="/supply/new" element={<NewSupply />} />
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
