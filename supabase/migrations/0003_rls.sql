-- =====================================================================
-- Uniforma Hub — Row Level Security
-- Это ЕДИНСТВЕННАЯ настоящая система прав в проекте.
-- Проверки в React обходятся через DevTools за полминуты.
-- =====================================================================

grant usage on schema app to authenticated, service_role;
grant execute on all functions in schema app to authenticated, service_role;
grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;

alter table app_settings      enable row level security;
alter table staff             enable row level security;
alter table audit_log         enable row level security;
alter table clients           enable row level security;
alter table client_contacts   enable row level security;
alter table measurements      enable row level security;
alter table orders            enable row level security;
alter table order_items       enable row level security;
alter table operations        enable row level security;
alter table tasks             enable row level security;
alter table payroll_accruals  enable row level security;
alter table payroll_payments  enable row level security;
alter table materials         enable row level security;
alter table supply_requests   enable row level security;
alter table transactions      enable row level security;

-- ---------- Настройки --------------------------------------------------
-- читают все (клиенту нужен таймаут автоблокировки), меняет только root

create policy settings_read   on app_settings for select to authenticated using (true);
create policy settings_write  on app_settings for update to authenticated using (app.is_root()) with check (app.is_root());

-- ---------- Сотрудники -------------------------------------------------
-- Добавляет / блокирует / меняет роли ТОЛЬКО root_admin.
-- DELETE-политики нет вообще: за швеёй тянутся задачи и зарплата,
-- физическое удаление строки посыпало бы отчёты. Только archived_at.

create policy staff_read on staff for select to authenticated
  using (id = app.current_staff_id() or app.is_manager_or_root());

create policy staff_insert on staff for insert to authenticated
  with check (app.is_root());

create policy staff_update on staff for update to authenticated
  using (app.is_root()) with check (app.is_root());

-- ---------- Аудит ------------------------------------------------------

create policy audit_read on audit_log for select to authenticated using (app.is_root());

-- ---------- CRM --------------------------------------------------------

create policy clients_read  on clients for select to authenticated using (true);
create policy clients_write on clients for all to authenticated
  using (app.is_manager_or_root()) with check (app.is_manager_or_root());

create policy contacts_read  on client_contacts for select to authenticated using (true);
create policy contacts_write on client_contacts for all to authenticated
  using (app.is_manager_or_root()) with check (app.is_manager_or_root());

create policy measure_read  on measurements for select to authenticated using (true);
create policy measure_write on measurements for all to authenticated
  using (app.is_manager_or_root()) with check (app.is_manager_or_root());

-- ---------- Заказы -----------------------------------------------------

create policy orders_read  on orders for select to authenticated using (true);
create policy orders_write on orders for all to authenticated
  using (app.is_manager_or_root()) with check (app.is_manager_or_root());

create policy items_read  on order_items for select to authenticated using (true);
create policy items_write on order_items for all to authenticated
  using (app.is_manager_or_root()) with check (app.is_manager_or_root());

create policy ops_read  on operations for select to authenticated using (true);
create policy ops_write on operations for all to authenticated
  using (app.is_root()) with check (app.is_root());

-- ---------- Задачи -----------------------------------------------------
-- Швея видит и двигает только свои. Легальность перехода статуса
-- дополнительно проверяет триггер validate_task_transition.

create policy tasks_read on tasks for select to authenticated
  using (assignee_staff_id = app.current_staff_id() or app.is_manager_or_root());

create policy tasks_insert on tasks for insert to authenticated
  with check (app.is_manager_or_root());

create policy tasks_update on tasks for update to authenticated
  using (assignee_staff_id = app.current_staff_id() or app.is_manager_or_root())
  with check (assignee_staff_id = app.current_staff_id() or app.is_manager_or_root());

create policy tasks_delete on tasks for delete to authenticated
  using (app.is_manager_or_root());

-- ---------- Зарплата ---------------------------------------------------
-- Швея ВСЕГДА видит свои начисления и выплаты без всякого PIN'а:
-- это её деньги, и открытая цифра снимает большую часть споров.
-- Чужие строки видит только root и только с разблокированными финансами.

create policy accruals_read on payroll_accruals for select to authenticated
  using (staff_id = app.current_staff_id() or app.can_read_finance());

create policy accruals_write on payroll_accruals for all to authenticated
  using (app.can_read_finance()) with check (app.can_read_finance());

create policy payments_read on payroll_payments for select to authenticated
  using (staff_id = app.current_staff_id() or app.can_read_finance());

create policy payments_write on payroll_payments for all to authenticated
  using (app.can_read_finance()) with check (app.can_read_finance());

-- ---------- Материалы и закуп ------------------------------------------

create policy materials_read  on materials for select to authenticated using (true);
create policy materials_write on materials for all to authenticated
  using (app.is_manager_or_root()) with check (app.is_manager_or_root());

create policy supply_read on supply_requests for select to authenticated
  using (requested_by_staff_id = app.current_staff_id() or app.is_manager_or_root());

-- швея может создать заявку только от своего имени
create policy supply_insert on supply_requests for insert to authenticated
  with check (requested_by_staff_id = app.current_staff_id());

create policy supply_update on supply_requests for update to authenticated
  using (app.is_manager_or_root()
         or (requested_by_staff_id = app.current_staff_id() and status = 'new'))
  with check (app.is_manager_or_root()
         or (requested_by_staff_id = app.current_staff_id() and status in ('new', 'rejected')));

-- ---------- Финансы ----------------------------------------------------
-- Только root_admin и только при действующем claim'е fin_exp в JWT.

create policy txn_all on transactions for all to authenticated
  using (app.can_read_finance()) with check (app.can_read_finance());
