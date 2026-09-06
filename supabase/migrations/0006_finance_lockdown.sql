-- =====================================================================
-- Финансовая часть — только администратору.
-- Интерфейс можно обойти через DevTools, поэтому запрет ставится в БД.
-- =====================================================================

-- Проведение покупки создаёт расход в transactions, то есть является
-- финансовой операцией. Менеджер может вести список закупа и отклонять
-- заявки, но проставить фактическую сумму может только root_admin.
create or replace function app.guard_supply_cost() returns trigger
language plpgsql as $$
begin
  if new.purchased_cost_uzs is distinct from old.purchased_cost_uzs
     and not app.is_root() then
    raise exception 'Проводить покупку и вносить суммы может только администратор';
  end if;
  return new;
end;
$$;

create trigger trg_guard_supply_cost before update on supply_requests
  for each row execute function app.guard_supply_cost();

-- Цены в заказе — тоже деньги. Менеджер ведёт состав заказа,
-- суммы проставляет администратор.
create or replace function app.guard_item_price() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE'
     and new.unit_price_uzs is distinct from old.unit_price_uzs
     and not app.is_root() then
    raise exception 'Изменять цены может только администратор';
  end if;
  if tg_op = 'INSERT' and new.unit_price_uzs > 0 and not app.is_root() then
    raise exception 'Проставлять цены может только администратор';
  end if;
  return new;
end;
$$;

create trigger trg_guard_item_price before insert or update on order_items
  for each row execute function app.guard_item_price();

-- Расценки в задачах определяют зарплату — назначает только администратор.
create or replace function app.guard_task_rate() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE'
     and new.rate_uzs is distinct from old.rate_uzs
     and not app.is_root() then
    raise exception 'Изменять расценку может только администратор';
  end if;
  return new;
end;
$$;

create trigger trg_guard_task_rate before update on tasks
  for each row execute function app.guard_task_rate();
