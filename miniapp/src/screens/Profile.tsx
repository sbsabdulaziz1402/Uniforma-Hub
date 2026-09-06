import { useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../App";
import { setFinancePin } from "../lib/api";
import { haptic, tg } from "../lib/tg";
import PinPad from "../components/PinPad";

const ROLE_LABEL = {
  root_admin: "Администратор",
  manager: "Менеджер",
  seamstress: "Швея",
} as const;

/** Профиль и админка: всё, что не нужно каждый день, собрано здесь. */
export default function Profile() {
  const { me } = useApp();
  const [pinStage, setPinStage] = useState<null | "first" | "confirm">(null);
  const [firstPin, setFirstPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);

  const isRoot = me.role === "root_admin";
  const isMgr = isRoot || me.role === "manager";

  const savePin = async (pin: string) => {
    if (pinStage === "first") {
      setFirstPin(pin); setPinStage("confirm"); setPinError(null);
      return true;
    }
    if (pin !== firstPin) {
      setFirstPin(""); setPinStage("first");
      setPinError("PIN не совпал. Задайте заново.");
      return false;
    }
    try {
      await setFinancePin(pin, undefined);
      tg().showAlert("PIN сохранён");
      setPinStage(null); setFirstPin("");
      return true;
    } catch (e) {
      setPinError((e as Error).message);
      setFirstPin(""); setPinStage("first");
      return false;
    }
  };

  if (pinStage) {
    return (
      <div className="page">
        <PinPad
          key={pinStage + firstPin}
          title={pinStage === "first" ? "Задайте PIN" : "Повторите PIN"}
          subtitle={pinStage === "first" ? "6 цифр для доступа к финансам" : "Ещё раз — чтобы не ошибиться."}
          error={pinError}
          onComplete={savePin}
        />
        <button className="ghost" style={{ marginTop: 20 }}
          onClick={() => { setPinStage(null); setFirstPin(""); setPinError(null); }}>
          Отмена
        </button>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="h1">Профиль</div>

      <div className="card">
        <div className="row">
          <div className="col">
            <b style={{ fontSize: 18 }}>{me.full_name}</b>
            <span className="hint">{me.phone}</span>
          </div>
          <span className="badge">{ROLE_LABEL[me.role]}</span>
        </div>
      </div>

      {isRoot && (
        <>
          <div className="stat-label" style={{ margin: "22px 4px 10px" }}>Финансы</div>
          <Item to="/finance" icon="📊" title="Расходы и прибыль" note="по PIN-коду" />
          <Item to="/payroll" icon="💵" title="Зарплата" note="по PIN-коду" />
        </>
      )}

      {isMgr && (
        <>
          <div className="stat-label" style={{ margin: "22px 4px 10px" }}>Цех</div>
          <Item to="/supply" icon="🛒" title="Закуп материалов" />
          {isRoot && <Item to="/catalog/garments" icon="👕" title="Изделия" note="справочник" />}
          {isRoot && <Item to="/catalog/materials" icon="🧵" title="Материалы" note="справочник" />}
          {isMgr && <Item to="/catalog/agencies" icon="🏛" title="Госорганы" note="справочник" />}
        </>
      )}

      {isRoot && (
        <>
          <div className="stat-label" style={{ margin: "22px 4px 10px" }}>Управление</div>
          <Item to="/staff" icon="👥" title="Сотрудники" />
          <div className="card" onClick={() => { haptic(); setPinStage("first"); }}
            style={{ cursor: "pointer" }}>
            <div className="row">
              <div className="col">
                <b>🔐 PIN для финансов</b>
                <span className="hint">{me.has_finance_pin ? "Задан" : "Не задан"}</span>
              </div>
              <span className="hint">{me.has_finance_pin ? "Сменить ›" : "Задать ›"}</span>
            </div>
          </div>
        </>
      )}

      {me.role === "seamstress" && (
        <>
          <div className="stat-label" style={{ margin: "22px 4px 10px" }}>Моё</div>
          <Item to="/earnings" icon="💰" title="Мой заработок" />
        </>
      )}
    </div>
  );
}

function Item({ to, icon, title, note }: { to: string; icon: string; title: string; note?: string }) {
  return (
    <Link to={to} style={{ textDecoration: "none", color: "inherit" }}>
      <div className="card">
        <div className="row">
          <b>{icon} {title}</b>
          <span className="hint">{note ? `${note} ›` : "›"}</span>
        </div>
      </div>
    </Link>
  );
}
