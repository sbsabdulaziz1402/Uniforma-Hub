# Uniforma Hub

Telegram-бот + Mini App для ателье по пошиву форменной одежды (Ташкент).

Модули: заказчики и мерки, заказы, задачи швеям, сдельная зарплата,
заявки на закуп материалов, финансы (доход / расход / прибыль).

## Стек

| Что | Чем |
|---|---|
| БД, авторизация, файлы | Supabase (Postgres 15 + RLS + Storage) |
| Бот | grammY на Supabase Edge Functions (Deno) |
| Mini App | React 18 + TypeScript + Vite |
| Хостинг Mini App | Vercel |

Отдельного сервера, Docker и Redis нет — намеренно. Для ателье на 5–30 человек
это лишняя инфраструктура и лишние деньги.

## Как устроен вход

Паролей нет. Доступ = номер телефона в таблице `staff`.

```
/start  →  бот просит контакт  →  Telegram отдаёт ПРОВЕРЕННЫЙ номер
        →  номер есть в staff?  →  нет: «доступ не выдан», конец
                                →  да:  привязали telegram_id, открыли меню
Mini App стартует → шлёт initData → Edge Function проверяет HMAC-подпись
        → выпускает Supabase JWT с claim'ами app_role и staff_id
        → RLS в Postgres разграничивает доступ
```

Ключевое: **вся система прав живёт в RLS-политиках Postgres**, а не в React.
Проверки на клиенте обходятся через DevTools за полминуты.

## Финансовый замок

Отчёты открываются по 6-значному PIN. Блокировка срабатывает:

1. по бездействию — `app_settings.finance_idle_lock_seconds`, по умолчанию **15 секунд**;
2. **мгновенно при сворачивании Telegram** — это и есть главная защита,
   короткий таймер лишь гигиена;
3. по истечении `fin_exp` внутри самого токена.

Блокировка — это не скрытие экрана, а выпуск токена без claim'а `fin_exp`:
после неё Postgres перестаёт отдавать строки из `transactions`.

Если 15 секунд окажутся неудобными (а они, скорее всего, окажутся —
это меньше, чем нужно, чтобы прочитать один график), значение меняется
в `app_settings` без передеплоя.

## Установка

### 1. Supabase

```bash
npm i -g supabase
supabase link --project-ref <ваш-ref>   # регион: Frankfurt eu-central-1
supabase db push
```

Перед `db push` отредактируйте `supabase/migrations/0004_seed.sql` —
поставьте реальный телефон первого администратора. Это единственный
способ войти в систему в первый раз.

### 2. Переменные окружения функций

```bash
supabase secrets set \
  TELEGRAM_BOT_TOKEN=<токен от @BotFather> \
  TELEGRAM_WEBHOOK_SECRET=<любая случайная строка> \
  APP_JWT_SECRET=<Settings → API → JWT Secret> \
  MINIAPP_URL=https://<ваш-проект>.vercel.app

supabase functions deploy auth
supabase functions deploy bot
```

`APP_JWT_SECRET` — это legacy HS256-секрет проекта. Если в проекте
включены асимметричные ключи, secret всё равно доступен в Settings → API;
именно им подписываются наши токены.

### 3. Webhook Telegram

```bash
curl "https://api.telegram.org/bot<ТОКЕН>/setWebhook?url=https://<ref>.supabase.co/functions/v1/bot&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

### 4. Mini App

```bash
cd miniapp
cp .env.example .env      # заполнить URL и anon key
npm install
npm run dev
```

Деплой на Vercel: root directory `miniapp`, переменные `VITE_SUPABASE_URL`
и `VITE_SUPABASE_ANON_KEY`.

### 5. Кнопка Mini App в боте

@BotFather → `/mybots` → Bot Settings → Menu Button → URL вашего Vercel-домена.

## Уведомления из БД

`POST /functions/v1/bot/notify` с заголовком `x-webhook-secret`.
Подключается через Supabase → Database → Webhooks. Типы:
`task_assigned`, `task_accepted`, `task_rework`, `salary_paid`,
`finance_lockout`, `custom`.

## Правила, которые не стоит нарушать

- **Деньги — `BIGINT` в сумах, без копеек.** Никогда не `float`.
- **Баланс швеи нигде не хранится.** Только два журнала: `payroll_accruals`
  и `payroll_payments`, разница считается представлением `v_staff_balance`.
  Хранимый баланс рано или поздно разъедется с журналами, и доказать
  правоту в споре будет нечем.
- **Сотрудников не удаляем**, только `archived_at`. За швеёй тянутся задачи
  и начисления.
- **Расценка пишется в задачу снимком.** Иначе изменение прайса задним
  числом пересчитает прошлую зарплату.
- **Начисление — только на `accepted`**, после ОТК. Не на «Готово».
- **Заявка на закуп денег не двигает.** Расход возникает в момент покупки
  с фактической ценой.

## Что дальше

- Создание заказа и позиций из Mini App (сейчас только просмотр и пайплайн)
- Карточка мерок с фото
- Массовое назначение задач на партию изделий
- Экспорт в Excel для бухгалтера

Не входит и пока не планируется: ЭДО/ЭСФ (Didox), E-IMZO, xarid.uzex.uz,
интеграция с 1С. Добавляются, когда пойдут реальные госконтракты.
