import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "../App";
import { db, setFinancePin } from "../lib/api";
import { dateTime, phoneMask, toE164 } from "../lib/format";
import { confirm, haptic, tg } from "../lib/tg";
import PinPad from "../components/PinPad";

const ROLE_LABEL = { root_admin: "Администратор", manager: "Менеджер", seamstress: "Швея" } as const;

export default function Staff() {
  const { me } = useApp();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [pinMode, setPinMode] = useState(false);

  const list = useQuery({
    queryKey: ["staff"],
    queryFn: async () => {
      const { data, error } = await db()
        .from("staff")
        .select("id,full_name,phone,role,is_active,telegram_id,last_seen_at")
        .is("archived_at", null)
        .order("role").order("full_name");
      if (error) throw error;
      return data;
    },
  });

  const toggle = useMutation({
    mutationFn: async (s: { id: string; is_active: boolean }) => {
      const { error } = await db().from("staff").update({ is_active: !s.is_active }).eq("id", s.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff"] }),
    onError: (e: Error) => tg().showAlert(e.message),
  });

  // Мягкое удаление: за швеёй тянутся задачи и начисления,
  // физическое удаление строки развалило бы зарплатные отчёты.
  const archive = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db().from("staff")
        .update({ archived_at: new Date().toISOString(), is_active: false }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff"] }),
    onError: (e: Error) => tg().showAlert(e.message),
  });

  if (pinMode) {
    return (
      <div className="page">
        <PinPad
          title="Новый PIN для финансов"
          subtitle="6 цифр. Понадобится при каждом входе в отчёты."
          onComplete={async (pin) => {
            try {
              await setFinancePin(pin);
              tg().showAlert("PIN сохранён");
              setPinMode(false);
              return true;
            } catch (e) {
              tg().showAlert((e as Error).message);
              return false;
            }
          }}
        />
        <button className="ghost" style={{ marginTop: 16 }} onClick={() => setPinMode(false)}>Отмена</button>
      </div>
    );
  }

  if (adding) return <AddStaff onDone={() => { setAdding(false); qc.invalidateQueries({ queryKey: ["staff"] }); }} />;

  return (
    <div className="page">
      <div className="h1">Сотрудники</div>

      <button onClick={() => { haptic(); setAdding(true); }}>+ Добавить сотрудника</button>

      <div className="hint" style={{ margin: "12px 2px" }}>
        Человек входит сам: открывает бота, отправляет свой номер. Номера, которого здесь нет,
        бот не пускает.
      </div>

      {(list.data ?? []).map((s) => (
        <div className="card" key={s.id}>
          <div className="row">
            <div className="col" style={{ minWidth: 0 }}>
              <b>{s.full_name}{s.id === me.id && <span className="hint"> · вы</span>}</b>
              <span className="hint">{s.phone} · {ROLE_LABEL[s.role as keyof typeof ROLE_LABEL]}</span>
              <span className="hint">
                {s.telegram_id ? `был(а): ${dateTime(s.last_seen_at)}` : "ещё не заходил(а) в бота"}
              </span>
            </div>
            <span className={"badge " + (s.is_active ? "green" : "red")}>
              {s.is_active ? "активен" : "заблокирован"}
            </span>
          </div>

          {s.id !== me.id && (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="ghost" onClick={() => toggle.mutate(s)}>
                {s.is_active ? "Заблокировать" : "Разблокировать"}
              </button>
              <button className="danger" onClick={async () => {
                if (await confirm(`Убрать ${s.full_name} из списка? История задач и зарплаты сохранится.`)) {
                  archive.mutate(s.id);
                }
              }}>Убрать</button>
            </div>
          )}
        </div>
      ))}

      <div className="card" style={{ marginTop: 20 }}>
        <div className="row">
          <div className="col">
            <b>PIN для финансов</b>
            <span className="hint">{me.has_finance_pin ? "Задан" : "Не задан — отчёты недоступны"}</span>
          </div>
        </div>
        <button className="ghost" style={{ marginTop: 10 }} onClick={() => setPinMode(true)}>
          {me.has_finance_pin ? "Сменить PIN" : "Задать PIN"}
        </button>
      </div>
    </div>
  );
}

function AddStaff({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("+998 ");
  const [role, setRole] = useState("seamstress");
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const e164 = toE164(phone);
      if (e164.length !== 13) throw new Error("Введите номер полностью: +998 XX XXX XX XX");
      if (name.trim().length < 3) throw new Error("Укажите имя и фамилию");
      const { error } = await db().from("staff").insert({ full_name: name.trim(), phone: e164, role });
      if (error) throw new Error(error.code === "23505" ? "Такой номер уже есть в системе" : error.message);
    },
    onSuccess: () => { haptic("ok"); onDone(); },
    onError: (e: Error) => { haptic("err"); setErr(e.message); },
  });

  return (
    <div className="page">
      <div className="h1">Новый сотрудник</div>

      <label>Имя и фамилия</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Гулнора Каримова" />

      <label>Номер телефона</label>
      <input
        value={phone}
        inputMode="numeric"
        onChange={(e) => setPhone(phoneMask(e.target.value))}
        placeholder="+998 90 123 45 67"
      />
      <div className="hint" style={{ marginTop: 4 }}>
        Именно по этому номеру бот узнает человека при входе.
      </div>

      <label>Роль</label>
      <select value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="seamstress">Швея — свои задачи и заработок</option>
        <option value="manager">Менеджер — заказы, задачи, закуп</option>
        <option value="root_admin">Администратор — всё, включая финансы</option>
      </select>

      {err && <div style={{ color: "var(--danger)", marginTop: 12, fontSize: 14 }}>{err}</div>}

      <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
        <button className="ghost" onClick={onDone}>Отмена</button>
        <button onClick={() => save.mutate()} disabled={save.isPending}>Сохранить</button>
      </div>
    </div>
  );
}
