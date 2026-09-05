-- =====================================================================
-- Состояние диалогов бота.
-- Edge Functions без состояния, а заявку на закуп швея вводит в три шага,
-- поэтому шаг храним в БД, а не в памяти процесса.
-- =====================================================================

create table bot_sessions (
  telegram_id bigint primary key,
  state       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table bot_sessions enable row level security;
-- политик нет: таблица доступна только service_role (бот)

create index bot_sessions_stale_idx on bot_sessions (updated_at);
