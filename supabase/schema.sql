-- Esquema de sincronización en la nube para KellyClipAi Studio (ShortStudio)
-- Ejecuta este script una sola vez en el SQL Editor de tu proyecto Supabase.

CREATE TABLE IF NOT EXISTS public.shortstudio_projects (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS public.shortstudio_scheduled_posts (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS public.shortstudio_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shortstudio_projects_updated
  ON public.shortstudio_projects (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_shortstudio_posts_scheduled
  ON public.shortstudio_scheduled_posts (user_id, scheduled_at ASC);

ALTER TABLE public.shortstudio_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shortstudio_scheduled_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shortstudio_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shortstudio_projects_owner" ON public.shortstudio_projects;
CREATE POLICY "shortstudio_projects_owner"
  ON public.shortstudio_projects
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "shortstudio_posts_owner" ON public.shortstudio_scheduled_posts;
CREATE POLICY "shortstudio_posts_owner"
  ON public.shortstudio_scheduled_posts
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "shortstudio_settings_owner" ON public.shortstudio_settings;
CREATE POLICY "shortstudio_settings_owner"
  ON public.shortstudio_settings
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
