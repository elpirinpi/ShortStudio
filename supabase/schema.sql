-- KellyClipAi Studio (ShortStudio) - Esquema opcional de sincronización en Supabase
-- Ejecuta este script en el SQL Editor de tu proyecto Supabase para sincronizar proyectos,
-- ajustes y calendario de publicaciones por usuario (los archivos MP4 permanecen locales en tu PC).

create table if not exists public.shortstudio_projects (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists shortstudio_projects_user_idx
  on public.shortstudio_projects (user_id, updated_at desc);

alter table public.shortstudio_projects enable row level security;

drop policy if exists "Users manage own projects" on public.shortstudio_projects;
create policy "Users manage own projects"
  on public.shortstudio_projects
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.shortstudio_scheduled_posts (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null,
  scheduled_at timestamptz not null default now()
);

create index if not exists shortstudio_posts_user_idx
  on public.shortstudio_scheduled_posts (user_id, scheduled_at asc);

alter table public.shortstudio_scheduled_posts enable row level security;

drop policy if exists "Users manage own scheduled posts" on public.shortstudio_scheduled_posts;
create policy "Users manage own scheduled posts"
  on public.shortstudio_scheduled_posts
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.shortstudio_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.shortstudio_settings enable row level security;

drop policy if exists "Users manage own settings" on public.shortstudio_settings;
create policy "Users manage own settings"
  on public.shortstudio_settings
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
