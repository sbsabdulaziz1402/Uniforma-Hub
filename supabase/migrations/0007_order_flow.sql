-- =====================================================================
-- Оформление заказа: клиент по телефону, тип изделия, материал, швея
-- =====================================================================

-- Клиент — человек с телефоном; орган (ведомство) необязателен.
alter table clients add column if not exists phone  text;
alter table clients add column if not exists agency text;

-- Поиск по телефону идёт по префиксу, пока пользователь набирает
create index if not exists clients_phone_idx on clients (phone text_pattern_ops);

-- Справочник изделий. У каждого — операция по умолчанию, чтобы задача
-- швее создавалась автоматически, без отдельного выбора операции.
create table if not exists garment_types (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null unique,
  default_operation_id uuid references operations (id),
  is_active            boolean not null default true,
  sort_order           int not null default 100
);

alter table garment_types enable row level security;
create policy garments_read  on garment_types for select to authenticated using (true);
create policy garments_write on garment_types for all to authenticated
  using (app.is_root()) with check (app.is_root());

-- Материал, из которого шьётся позиция
alter table order_items add column if not exists material_id uuid references materials (id);

insert into operations (name, unit, default_rate_uzs) values
  ('Пошив юбки',   'шт', 70000),
  ('Пошив галстука','шт', 25000)
on conflict (name) do nothing;

insert into garment_types (name, default_operation_id, sort_order)
select v.name, op.id, v.ord
  from (values
        ('Китель',   'Пошив кителя',   10),
        ('Рубашка',  'Пошив рубашки',  20),
        ('Брюки',    'Пошив брюк',     30),
        ('Юбка',     'Пошив юбки',     40),
        ('Фуражка',  'Пошив фуражки',  50),
        ('Галстук',  'Пошив галстука', 60)
       ) as v(name, opname, ord)
  left join operations op on op.name = v.opname
on conflict (name) do nothing;
