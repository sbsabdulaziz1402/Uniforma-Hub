-- =====================================================================
-- Заказы от клиентов через бота: цены, источник заказа, привязка к Telegram
-- =====================================================================

-- Цена изделия и надбавка за материал: из них складывается сумма,
-- которую клиент видит в боте до отправки заявки.
alter table garment_types add column if not exists base_price_uzs bigint not null default 0;
alter table materials     add column if not exists price_per_unit_uzs bigint not null default 0;
alter table materials     add column if not exists client_visible boolean not null default true;

alter table clients add column if not exists telegram_id bigint;
create unique index if not exists clients_telegram_idx on clients (telegram_id) where telegram_id is not null;

-- Откуда пришёл заказ: из Mini App от сотрудника или из бота от клиента.
-- Заявки клиентов попадают в общий пайплайн со статусом «new».
alter table orders add column if not exists source text not null default 'staff'
  check (source in ('staff', 'client_bot'));

create index if not exists orders_source_idx on orders (source, created_at desc);

-- ---------- Правка охранных триггеров ---------------------------------
-- Бот работает под service_role: claim app_role у него отсутствует.
-- Без этой поправки триггеры отклоняли бы заказы клиентов,
-- потому что is_root() для бота ложно.

create or replace function app.guard_item_price() returns trigger
language plpgsql as $$
begin
  -- нет claim'а роли => запрос идёт с сервера (бот, миграция), это доверенный контекст
  if app.current_role() is null then
    return new;
  end if;
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

create or replace function app.guard_supply_cost() returns trigger
language plpgsql as $$
begin
  if app.current_role() is null then
    return new;
  end if;
  if new.purchased_cost_uzs is distinct from old.purchased_cost_uzs
     and not app.is_root() then
    raise exception 'Проводить покупку и вносить суммы может только администратор';
  end if;
  return new;
end;
$$;

create or replace function app.guard_task_rate() returns trigger
language plpgsql as $$
begin
  if app.current_role() is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.rate_uzs is distinct from old.rate_uzs
     and not app.is_root() then
    raise exception 'Изменять расценку может только администратор';
  end if;
  return new;
end;
$$;

-- Стартовые цены, чтобы бот не показывал клиенту нули
update garment_types g set base_price_uzs = v.price
  from (values ('Китель', 900000), ('Рубашка', 350000), ('Брюки', 450000),
               ('Юбка', 380000), ('Фуражка', 250000), ('Галстук', 90000)
       ) as v(name, price)
 where g.name = v.name and g.base_price_uzs = 0;
