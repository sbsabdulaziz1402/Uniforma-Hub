-- =====================================================================
-- Uniforma Hub — базовая схема
-- Все денежные суммы: BIGINT, в сумах (UZS), без копеек.
-- НИКОГДА не использовать float/real для денег.
-- =====================================================================

create schema if not exists app;

-- ---------- Перечисления ---------------------------------------------

create type staff_role     as enum ('root_admin', 'manager', 'seamstress');
create type order_status   as enum ('new', 'measuring', 'fitting', 'production', 'qc', 'ready', 'delivered', 'cancelled');
create type task_status    as enum ('assigned', 'in_progress', 'done', 'accepted', 'rework');
create type accrual_type   as enum ('piece', 'bonus', 'penalty', 'fixed');
create type payment_method as enum ('cash', 'card', 'transfer');
create type txn_type       as enum ('income', 'expense');
create type supply_status  as enum ('new', 'approved', 'purchased', 'received', 'rejected');
create type urgency_level  as enum ('blocking', 'week', 'stock');

-- ---------- Настройки (одна строка) -----------------------------------

create table app_settings (
  id                       smallint primary key default 1 check (id = 1),
  finance_idle_lock_seconds int      not null default 15  check (finance_idle_lock_seconds between 5 and 3600),
  finance_session_minutes   int      not null default 15  check (finance_session_minutes between 1 and 240),
  finance_max_attempts      int      not null default 5,
  finance_lockout_minutes   int      not null default 15,
  -- true  = переделка сжигает начисление полностью (строго)
  -- false = начисление остаётся, менеджер вручную ставит penalty
  rework_forfeits_full      boolean  not null default true,
  supply_requests_per_hour  int      not null default 10,
  updated_at                timestamptz not null default now()
);

-- ---------- Сотрудники -------------------------------------------------

create table staff (
  id                      uuid primary key default gen_random_uuid(),
  telegram_id             bigint unique,               -- заполняется при первом /start
  phone                   text   not null unique,      -- E.164: +998901234567
  full_name               text   not null,
  role                    staff_role not null default 'seamstress',
  is_active               boolean not null default true,
  archived_at             timestamptz,                 -- мягкое удаление, строки никогда не удаляем
  -- финансовый PIN (только для root_admin)
  finance_pin_hash        text,
  finance_failed_attempts int not null default 0,
  finance_locked_until    timestamptz,
  last_seen_at            timestamptz,
  note                    text,
  created_by              uuid references staff (id),
  created_at              timestamptz not null default now(),
  constraint phone_e164 check (phone ~ '^\+998[0-9]{9}$')
);

create index staff_role_idx      on staff (role) where archived_at is null;
create index staff_telegram_idx  on staff (telegram_id) where telegram_id is not null;

-- Защита «последний root_admin не может быть разжалован» — триггер в 0002.

-- ---------- Аудит ------------------------------------------------------

create table audit_log (
  id              bigserial primary key,
  actor_staff_id  uuid references staff (id),
  action          text not null,          -- 'staff.create', 'finance.unlock', ...
  target_table    text,
  target_id       text,
  diff            jsonb,
  created_at      timestamptz not null default now()
);

create index audit_log_created_idx on audit_log (created_at desc);
create index audit_log_actor_idx   on audit_log (actor_staff_id, created_at desc);

-- ---------- CRM: заказчики (госорганы) ---------------------------------

create table clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,               -- «ГУВД г. Ташкента»
  short_name  text,
  inn         text,                        -- ИНН, 9 цифр
  address     text,
  note        text,
  is_active   boolean not null default true,
  created_by  uuid references staff (id),
  created_at  timestamptz not null default now(),
  constraint inn_format check (inn is null or inn ~ '^[0-9]{9}$')
);

create table client_contacts (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients (id) on delete cascade,
  full_name   text not null,
  position    text,                        -- должность / звание
  phone       text,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now()
);

create index client_contacts_client_idx on client_contacts (client_id);

-- ---------- Мерки ------------------------------------------------------

create table measurements (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid references clients (id) on delete set null,
  person_full_name  text not null,          -- на кого шьётся
  person_position   text,                   -- звание / должность
  height_cm         numeric(5,1),
  chest_cm          numeric(5,1),
  waist_cm          numeric(5,1),
  hips_cm           numeric(5,1),
  neck_cm           numeric(5,1),
  shoulder_cm       numeric(5,1),
  sleeve_cm         numeric(5,1),
  inseam_cm         numeric(5,1),
  jacket_len_cm     numeric(5,1),
  trouser_len_cm    numeric(5,1),
  extra             jsonb not null default '{}'::jsonb,  -- нестандартные мерки
  photo_urls        text[] not null default '{}',
  note              text,
  measured_by       uuid references staff (id),
  measured_at       timestamptz not null default now()
);

create index measurements_client_idx on measurements (client_id);
create index measurements_name_idx   on measurements using gin (to_tsvector('simple', person_full_name));

-- ---------- Заказы -----------------------------------------------------

create sequence order_number_seq;

create table orders (
  id               uuid primary key default gen_random_uuid(),
  number           text not null unique,    -- UH-2026-0001, проставляется триггером
  client_id        uuid not null references clients (id),
  title            text not null,
  status           order_status not null default 'new',
  contract_number  text,
  contract_date    date,
  deadline         date,
  note             text,
  created_by       uuid references staff (id),
  created_at       timestamptz not null default now(),
  delivered_at     timestamptz
);

create index orders_status_idx   on orders (status) where status <> 'delivered';
create index orders_client_idx   on orders (client_id);
create index orders_deadline_idx on orders (deadline) where status not in ('delivered', 'cancelled');

create table order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references orders (id) on delete cascade,
  garment_type    text not null,            -- «Китель», «Брюки», «Фуражка»
  size_label      text,
  qty             int  not null default 1 check (qty > 0),
  unit_price_uzs  bigint not null default 0 check (unit_price_uzs >= 0),
  total_uzs       bigint generated always as (qty::bigint * unit_price_uzs) stored,
  measurement_id  uuid references measurements (id) on delete set null,
  specs           jsonb not null default '{}'::jsonb,  -- ткань, фурнитура, шевроны
  note            text,
  created_at      timestamptz not null default now()
);

create index order_items_order_idx on order_items (order_id);

-- ---------- Операции и задачи -----------------------------------------

create table operations (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique,   -- «Пошив кителя», «Пришив шеврона»
  unit              text not null default 'шт',
  default_rate_uzs  bigint not null default 0 check (default_rate_uzs >= 0),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

create table tasks (
  id                 uuid primary key default gen_random_uuid(),
  order_item_id      uuid not null references order_items (id) on delete cascade,
  operation_id       uuid not null references operations (id),
  assignee_staff_id  uuid references staff (id),
  qty                numeric(12,3) not null default 1 check (qty > 0),
  -- расценка СНИМКОМ на момент назначения: изменение прайса
  -- не должно задним числом пересчитывать прошлую зарплату
  rate_uzs           bigint not null check (rate_uzs >= 0),
  amount_uzs         bigint generated always as (round(qty * rate_uzs)::bigint) stored,
  status             task_status not null default 'assigned',
  deadline           date,
  instructions       text,
  rework_reason      text,
  started_at         timestamptz,
  finished_at        timestamptz,
  accepted_at        timestamptz,
  accepted_by        uuid references staff (id),
  created_by         uuid references staff (id),
  created_at         timestamptz not null default now()
);

create index tasks_assignee_idx on tasks (assignee_staff_id, status);
create index tasks_item_idx     on tasks (order_item_id);
create index tasks_deadline_idx on tasks (deadline) where status not in ('accepted');

-- ---------- Зарплата: два журнала, баланс НЕ хранится -------------------

create table payroll_accruals (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references staff (id),
  task_id     uuid references tasks (id) on delete set null,
  order_id    uuid references orders (id) on delete set null,  -- для себестоимости заказа
  type        accrual_type not null default 'piece',
  -- penalty пишется ОТРИЦАТЕЛЬНОЙ суммой: вся арифметика остаётся одним sum()
  amount_uzs  bigint not null,
  note        text,
  created_by  uuid references staff (id),
  accrued_at  timestamptz not null default now(),
  constraint penalty_is_negative check (
    (type = 'penalty' and amount_uzs < 0) or (type <> 'penalty' and amount_uzs >= 0)
  )
);

create unique index payroll_accruals_task_uq on payroll_accruals (task_id)
  where task_id is not null and type = 'piece';   -- одна задача = одно сдельное начисление

create index payroll_accruals_staff_idx on payroll_accruals (staff_id, accrued_at desc);
create index payroll_accruals_order_idx on payroll_accruals (order_id);

create table payroll_payments (
  id                uuid primary key default gen_random_uuid(),
  staff_id          uuid not null references staff (id),
  amount_uzs        bigint not null check (amount_uzs > 0),
  method            payment_method not null default 'cash',
  note              text,
  paid_by_staff_id  uuid references staff (id),
  paid_at           timestamptz not null default now()
);

create index payroll_payments_staff_idx on payroll_payments (staff_id, paid_at desc);

-- ---------- Материалы и закуп ------------------------------------------

create table materials (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  unit        text not null default 'шт',
  stock_qty   numeric(12,3) not null default 0,
  min_qty     numeric(12,3) not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table supply_requests (
  id                   uuid primary key default gen_random_uuid(),
  requested_by_staff_id uuid not null references staff (id),
  material_id          uuid references materials (id) on delete set null,
  item_name_raw        text not null,        -- то, что швея написала текстом
  qty                  numeric(12,3) not null check (qty > 0),
  unit                 text not null default 'шт',
  urgency              urgency_level not null default 'week',
  order_id             uuid references orders (id) on delete set null,
  note                 text,
  photo_url            text,
  status               supply_status not null default 'new',
  -- фактическая цена появляется ТОЛЬКО в момент покупки
  purchased_qty        numeric(12,3),
  purchased_cost_uzs   bigint check (purchased_cost_uzs is null or purchased_cost_uzs >= 0),
  decided_by           uuid references staff (id),
  decided_at           timestamptz,
  created_at           timestamptz not null default now()
);

create index supply_requests_status_idx on supply_requests (status, urgency, created_at);
create index supply_requests_author_idx on supply_requests (requested_by_staff_id, created_at desc);

-- ---------- Финансы ----------------------------------------------------

create table transactions (
  id                  uuid primary key default gen_random_uuid(),
  type                txn_type not null,
  category            text not null,        -- 'Оплата заказа', 'Материалы', 'Зарплата', 'Аренда'
  amount_uzs          bigint not null check (amount_uzs > 0),
  occurred_at         timestamptz not null default now(),
  order_id            uuid references orders (id) on delete set null,
  counterparty        text,
  note                text,
  -- обратные ссылки: расход по зарплате и закупу создаётся автоматически
  payroll_payment_id  uuid unique references payroll_payments (id) on delete cascade,
  supply_request_id   uuid unique references supply_requests (id) on delete cascade,
  created_by          uuid references staff (id),
  created_at          timestamptz not null default now()
);

create index transactions_occurred_idx on transactions (occurred_at desc);
create index transactions_order_idx    on transactions (order_id);
create index transactions_type_idx     on transactions (type, occurred_at desc);
