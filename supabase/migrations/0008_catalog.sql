-- =====================================================================
-- Госорганы, фото изделий, связь материалов с изделиями
-- =====================================================================

create table if not exists agencies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,          -- «ГУВД г. Ташкента»
  short_name text,
  note       text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

alter table agencies enable row level security;
create policy agencies_read  on agencies for select to authenticated using (true);
create policy agencies_write on agencies for all to authenticated
  using (app.is_manager_or_root()) with check (app.is_manager_or_root());

-- Изделие шьётся для конкретного ведомства и имеет фото-образец
alter table garment_types add column if not exists agency_id uuid references agencies (id) on delete set null;
alter table garment_types add column if not exists photo_url text;

-- Какие материалы идут на какое изделие: связь многие-ко-многим.
-- Нужна, чтобы при заказе подсказывать только подходящие материалы.
create table if not exists material_garments (
  material_id     uuid not null references materials (id) on delete cascade,
  garment_type_id uuid not null references garment_types (id) on delete cascade,
  primary key (material_id, garment_type_id)
);

alter table material_garments enable row level security;
create policy mg_read  on material_garments for select to authenticated using (true);
create policy mg_write on material_garments for all to authenticated
  using (app.is_root()) with check (app.is_root());

create index if not exists mg_garment_idx on material_garments (garment_type_id);

-- Заказ тоже привязывается к ведомству
alter table clients add column if not exists agency_id uuid references agencies (id) on delete set null;

-- ---------- Хранилище фото ---------------------------------------------

insert into storage.buckets (id, name, public)
values ('catalog', 'catalog', true)
on conflict (id) do nothing;

drop policy if exists "catalog_public_read" on storage.objects;
create policy "catalog_public_read" on storage.objects
  for select using (bucket_id = 'catalog');

drop policy if exists "catalog_staff_write" on storage.objects;
create policy "catalog_staff_write" on storage.objects
  for insert to authenticated with check (bucket_id = 'catalog');

drop policy if exists "catalog_staff_update" on storage.objects;
create policy "catalog_staff_update" on storage.objects
  for update to authenticated using (bucket_id = 'catalog');
