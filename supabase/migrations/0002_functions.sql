-- =====================================================================
-- Uniforma Hub — функции, триггеры, представления
-- =====================================================================

-- ---------- Доступ к claim'ам JWT --------------------------------------
-- Внимание: claim называется app_role, а НЕ role.
-- 'role' зарезервирован Supabase под роль Postgres (authenticated).

create or replace function app.current_staff_id() returns uuid
language sql stable as $$
  -- nullif ДО приведения к jsonb: при отсутствии claim'ов current_setting
  -- возвращает пустую строку, и ''::jsonb падает с ошибкой, ломая любой запрос
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'staff_id', '')::uuid;
$$;

create or replace function app.current_role() returns staff_role
language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'app_role', '')::staff_role;
$$;

create or replace function app.is_root() returns boolean
language sql stable as $$ select app.current_role() = 'root_admin'; $$;

create or replace function app.is_manager_or_root() returns boolean
language sql stable as $$ select app.current_role() in ('root_admin', 'manager'); $$;

-- Финансовый замок: экран с PIN'ом — это картинка, обходится через DevTools.
-- Настоящая защита здесь: без свежего claim'а fin_exp строки просто не отдаются.
create or replace function app.is_finance_unlocked() returns boolean
language sql stable as $$
  select coalesce(
    (nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'fin_exp', ''))::bigint
      > extract(epoch from now()),
    false
  );
$$;

create or replace function app.can_read_finance() returns boolean
language sql stable as $$ select app.is_root() and app.is_finance_unlocked(); $$;

-- ---------- Номер заказа: UH-2026-0001 ---------------------------------

create or replace function app.set_order_number() returns trigger
language plpgsql as $$
begin
  if new.number is null or new.number = '' then
    new.number := 'UH-' || to_char(now(), 'YYYY') || '-' ||
                  lpad(nextval('order_number_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

create trigger trg_order_number before insert on orders
  for each row execute function app.set_order_number();

-- ---------- Защита последнего root-админа ------------------------------

create or replace function app.guard_last_root() returns trigger
language plpgsql as $$
declare
  remaining int;
begin
  if old.role = 'root_admin'
     and (new.role <> 'root_admin' or not new.is_active or new.archived_at is not null) then
    select count(*) into remaining
      from staff
     where role = 'root_admin' and is_active and archived_at is null and id <> old.id;
    if remaining = 0 then
      raise exception 'Нельзя убрать последнего активного root-администратора';
    end if;
  end if;

  -- нельзя разжаловать или заблокировать самого себя
  if old.id = app.current_staff_id()
     and (new.role <> old.role or new.is_active <> old.is_active) then
    raise exception 'Нельзя изменить собственную роль или статус';
  end if;

  return new;
end;
$$;

create trigger trg_guard_last_root before update on staff
  for each row execute function app.guard_last_root();

-- ---------- Задачи: допустимые переходы статусов -----------------------

create or replace function app.validate_task_transition() returns trigger
language plpgsql as $$
declare
  is_mgr boolean := app.is_manager_or_root();
begin
  if new.status = old.status then
    return new;
  end if;

  -- швея двигает только свои задачи и только вперёд по работе
  if not is_mgr then
    if new.assignee_staff_id is distinct from app.current_staff_id() then
      raise exception 'Задача назначена не вам';
    end if;
    if not ((old.status in ('assigned', 'rework') and new.status = 'in_progress')
            or (old.status = 'in_progress' and new.status = 'done')) then
      raise exception 'Недопустимый переход статуса: % -> %', old.status, new.status;
    end if;
  else
    -- приёмку и возврат в переделку делает только менеджер/админ
    -- accepted -> rework нужен, когда брак нашли уже после приёмки
    -- или менеджер принял по ошибке: начисление откатывается триггером ниже
    if not ((old.status = 'done'     and new.status in ('accepted', 'rework'))
            or (old.status = 'accepted' and new.status = 'rework')
            or (old.status = 'rework'   and new.status in ('assigned', 'in_progress'))
            or (old.status in ('assigned', 'in_progress') and new.status in ('assigned', 'in_progress', 'done'))) then
      raise exception 'Недопустимый переход статуса: % -> %', old.status, new.status;
    end if;
  end if;

  if new.status = 'in_progress' and new.started_at is null then
    new.started_at := now();
  end if;
  if new.status = 'done' then
    new.finished_at := now();
  end if;
  if new.status = 'accepted' then
    new.accepted_at := now();
    new.accepted_by := app.current_staff_id();
  end if;

  return new;
end;
$$;

create trigger trg_task_transition before update of status on tasks
  for each row execute function app.validate_task_transition();

-- ---------- Начисление зарплаты ----------------------------------------
-- Деньги начисляются ТОЛЬКО при 'accepted' (после ОТК), а не когда
-- швея нажала «Готово». Иначе за брак платят так же, как за годное.

create or replace function app.accrue_on_task_accept() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  v_order_id uuid;
  v_strict   boolean;
begin
  if new.status = 'accepted' and old.status <> 'accepted' then
    if new.assignee_staff_id is null or new.amount_uzs <= 0 then
      return new;
    end if;

    select o.id into v_order_id
      from order_items oi join orders o on o.id = oi.order_id
     where oi.id = new.order_item_id;

    insert into payroll_accruals (staff_id, task_id, order_id, type, amount_uzs, note)
    values (new.assignee_staff_id, new.id, v_order_id, 'piece', new.amount_uzs, 'Автоначисление за принятую задачу')
    on conflict (task_id) where task_id is not null and type = 'piece' do nothing;

  elsif new.status = 'rework' and old.status = 'accepted' then
    select rework_forfeits_full into v_strict from app_settings where id = 1;
    if coalesce(v_strict, true) then
      -- строгий режим: начисление сгорает полностью
      delete from payroll_accruals where task_id = new.id and type = 'piece';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_accrue_on_accept after update of status on tasks
  for each row execute function app.accrue_on_task_accept();

-- ---------- Выплата зарплаты = расход компании -------------------------
-- Без этого экран «Расходы и прибыль» врёт на весь фонд оплаты труда.

create or replace function app.txn_from_payroll_payment() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  v_name text;
begin
  select full_name into v_name from staff where id = new.staff_id;

  insert into transactions (type, category, amount_uzs, occurred_at, counterparty,
                            note, payroll_payment_id, created_by)
  values ('expense', 'Зарплата', new.amount_uzs, new.paid_at, v_name,
          new.note, new.id, new.paid_by_staff_id);

  return new;
end;
$$;

create trigger trg_txn_from_payment after insert on payroll_payments
  for each row execute function app.txn_from_payroll_payment();

-- ---------- Закуп: покупка = расход + приход на склад ------------------
-- Заявка сама по себе денег НЕ двигает. Расход возникает только
-- в момент покупки с фактической ценой.

create or replace function app.txn_from_supply_purchase() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  if new.status = 'purchased' and old.status is distinct from 'purchased'
     and new.purchased_cost_uzs is not null and new.purchased_cost_uzs > 0 then

    insert into transactions (type, category, amount_uzs, occurred_at, order_id,
                              note, supply_request_id, created_by)
    values ('expense', 'Материалы', new.purchased_cost_uzs, coalesce(new.decided_at, now()),
            new.order_id, new.item_name_raw, new.id, new.decided_by)
    on conflict (supply_request_id) do update
      set amount_uzs = excluded.amount_uzs,
          occurred_at = excluded.occurred_at;

    if new.material_id is not null then
      update materials
         set stock_qty = stock_qty + coalesce(new.purchased_qty, new.qty)
       where id = new.material_id;
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_txn_from_supply after update of status on supply_requests
  for each row execute function app.txn_from_supply_purchase();

-- ---------- Аудит изменений сотрудников --------------------------------

create or replace function app.audit_staff() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  insert into audit_log (actor_staff_id, action, target_table, target_id, diff)
  values (
    app.current_staff_id(),
    'staff.' || lower(tg_op),
    'staff',
    coalesce(new.id, old.id)::text,
    case tg_op
      when 'INSERT' then jsonb_build_object('new', to_jsonb(new) - 'finance_pin_hash')
      when 'UPDATE' then jsonb_build_object('old', to_jsonb(old) - 'finance_pin_hash',
                                            'new', to_jsonb(new) - 'finance_pin_hash')
      else jsonb_build_object('old', to_jsonb(old) - 'finance_pin_hash')
    end
  );
  return coalesce(new, old);
end;
$$;

create trigger trg_audit_staff after insert or update or delete on staff
  for each row execute function app.audit_staff();

-- =====================================================================
-- Представления
-- security_invoker = true — иначе view обошло бы RLS автора запроса
-- =====================================================================

-- Баланс швеи: начислено − выплачено. Колонки balance в таблицах НЕТ
-- намеренно: хранимый баланс рано или поздно разъезжается с журналами.
create or replace view v_staff_balance
with (security_invoker = true) as
select
  s.id as staff_id,
  s.full_name,
  s.role,
  coalesce(a.earned, 0)                        as earned_uzs,
  coalesce(p.paid, 0)                          as paid_uzs,
  coalesce(a.earned, 0) - coalesce(p.paid, 0)  as balance_uzs,
  a.last_accrual_at,
  p.last_payment_at
from staff s
left join (
  select staff_id, sum(amount_uzs) as earned, max(accrued_at) as last_accrual_at
    from payroll_accruals group by staff_id
) a on a.staff_id = s.id
left join (
  select staff_id, sum(amount_uzs) as paid, max(paid_at) as last_payment_at
    from payroll_payments group by staff_id
) p on p.staff_id = s.id
where s.archived_at is null;

-- Прибыльность заказа: выручка − материалы − труд
create or replace view v_order_profit
with (security_invoker = true) as
select
  o.id as order_id,
  o.number,
  o.title,
  o.status,
  coalesce(items.contract_uzs, 0)  as contract_uzs,   -- сумма по позициям
  coalesce(inc.paid_uzs, 0)        as received_uzs,   -- фактически получено
  coalesce(mat.cost_uzs, 0)        as materials_uzs,
  coalesce(lab.cost_uzs, 0)        as labor_uzs,
  coalesce(items.contract_uzs, 0)
    - coalesce(mat.cost_uzs, 0)
    - coalesce(lab.cost_uzs, 0)    as profit_uzs
from orders o
left join (select order_id, sum(total_uzs) contract_uzs from order_items group by order_id) items
       on items.order_id = o.id
left join (select order_id, sum(amount_uzs) paid_uzs from transactions
            where type = 'income' and order_id is not null group by order_id) inc
       on inc.order_id = o.id
left join (select order_id, sum(amount_uzs) cost_uzs from transactions
            where type = 'expense' and category = 'Материалы' and order_id is not null group by order_id) mat
       on mat.order_id = o.id
left join (select order_id, sum(amount_uzs) cost_uzs from payroll_accruals
            where order_id is not null group by order_id) lab
       on lab.order_id = o.id;

-- Сводный список закупа: одинаковые позиции от разных швей — одной строкой
create or replace view v_supply_board
with (security_invoker = true) as
select
  lower(trim(coalesce(m.name, sr.item_name_raw))) as item_key,
  coalesce(m.name, sr.item_name_raw)              as item_name,
  sr.unit,
  min(sr.urgency)                                 as urgency,   -- blocking < week < stock
  sum(sr.qty)                                     as total_qty,
  count(*)                                        as requests_count,
  array_agg(distinct s.full_name)                 as requested_by,
  array_agg(sr.id)                                as request_ids,
  min(sr.created_at)                              as first_requested_at
from supply_requests sr
join staff s on s.id = sr.requested_by_staff_id
left join materials m on m.id = sr.material_id
where sr.status in ('new', 'approved')
group by 1, 2, 3;

-- ---------- Финансовая сводка за период --------------------------------
-- Эти две функции вызываются из Mini App через PostgREST (.rpc()),
-- поэтому живут в public, а не в app: PostgREST видит только public.
-- security_invoker по умолчанию => RLS на transactions продолжает работать,
-- то есть без claim'а fin_exp обе вернут нули.

create or replace function public.finance_summary(p_from timestamptz, p_to timestamptz)
returns table (
  income_uzs  bigint,
  expense_uzs bigint,
  profit_uzs  bigint
)
language sql stable as $$
  select
    coalesce(sum(amount_uzs) filter (where type = 'income'), 0)::bigint,
    coalesce(sum(amount_uzs) filter (where type = 'expense'), 0)::bigint,
    (coalesce(sum(amount_uzs) filter (where type = 'income'), 0)
     - coalesce(sum(amount_uzs) filter (where type = 'expense'), 0))::bigint
  from transactions
  where occurred_at >= p_from and occurred_at < p_to;
$$;

create or replace function public.finance_daily(p_from timestamptz, p_to timestamptz)
returns table (
  day         date,
  income_uzs  bigint,
  expense_uzs bigint
)
language sql stable as $$
  select
    date_trunc('day', occurred_at)::date,
    coalesce(sum(amount_uzs) filter (where type = 'income'), 0)::bigint,
    coalesce(sum(amount_uzs) filter (where type = 'expense'), 0)::bigint
  from transactions
  where occurred_at >= p_from and occurred_at < p_to
  group by 1
  order by 1;
$$;

grant execute on function public.finance_summary(timestamptz, timestamptz) to authenticated;
grant execute on function public.finance_daily(timestamptz, timestamptz)   to authenticated;
