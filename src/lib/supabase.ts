import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AppSettings, ClipProject, ScheduledPost } from '../types/editor';

const rawUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const candidateKeys = [
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim(),
  (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim(),
];

function isPlaceholderKey(key: string): boolean {
  return (
    !key ||
    key === 'MY_SUPABASE_ANON_KEY' ||
    key === 'MY_SUPABASE_PUBLISHABLE_KEY'
  );
}

function isSecretSupabaseKey(key: string): boolean {
  if (!key) return false;
  if (key.startsWith('sb_secret_')) return true;
  if (key.startsWith('eyJ')) {
    try {
      const payloadSeg = key.split('.')[1];
      if (payloadSeg) {
        const b64 = payloadSeg.replace(/-/g, '+').replace(/_/g, '/');
        const json = JSON.parse(atob(b64)) as { role?: string };
        if (json?.role === 'service_role') return true;
      }
    } catch {
      // ignore malformed JWT payload
    }
  }
  return false;
}

const usableKeys = candidateKeys.filter((k) => !isPlaceholderKey(k));
const publicKey = usableKeys.find((k) => !isSecretSupabaseKey(k)) || '';

function isValidSupabaseUrl(url: string): boolean {
  if (!url || url === 'MY_SUPABASE_URL') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export const hasSupabaseUrl = isValidSupabaseUrl(rawUrl);
export const hasSecretSupabaseKeyOnly = !publicKey && usableKeys.some((k) => isSecretSupabaseKey(k));
export const hasSupabaseKey = Boolean(publicKey);

export const isSupabaseConfigured = hasSupabaseUrl && hasSupabaseKey;

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(rawUrl, publicKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function translateSupabaseError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('forbidden use of secret api key')) {
    return 'Se configuró una clave secreta (sb_secret / service_role) en lugar de la clave pública. Usa tu clave Publishable (sb_publishable_...) o anon public de Supabase.';
  }
  if (m.includes('invalid login credentials')) {
    return 'Correo electrónico o contraseña incorrectos.';
  }
  if (m.includes('email not confirmed')) {
    return 'Debes confirmar tu correo electrónico antes de iniciar sesión.';
  }
  if (m.includes('user already registered')) {
    return 'Este correo ya está registrado. Inicia sesión con tu contraseña.';
  }
  if (m.includes('password should be at least')) {
    return 'La contraseña debe tener al menos 6 caracteres.';
  }
  if (m.includes('rate limit') || m.includes('too many requests')) {
    return 'Demasiados intentos. Espera un momento e inténtalo de nuevo.';
  }
  if (m.includes('unable to validate email')) {
    return 'Ingresa una dirección de correo electrónico válida.';
  }
  if (m.includes('failed to fetch') || m.includes('network')) {
    return 'No se pudo conectar con Supabase. Verifica VITE_SUPABASE_URL y tu conexión a internet.';
  }
  return message;
}

export type CloudSyncStatus = 'idle' | 'syncing' | 'synced' | 'tables-missing' | 'error' | 'offline';

export async function checkCloudSyncHealth(
  userId: string
): Promise<{ status: CloudSyncStatus; detail?: string }> {
  if (!supabase) return { status: 'offline', detail: 'Supabase no configurado.' };
  try {
    const { error } = await supabase
      .from('shortstudio_projects')
      .select('id', { head: true, count: 'exact' })
      .eq('user_id', userId);
    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (
        error.code === '42P01' ||
        error.code === 'PGRST205' ||
        msg.includes('does not exist') ||
        msg.includes('could not find the table')
      ) {
        return {
          status: 'tables-missing',
          detail: 'Ejecuta supabase/schema.sql en el SQL Editor de tu proyecto Supabase para activar la sincronización.',
        };
      }
      return { status: 'error', detail: error.message };
    }
    return { status: 'synced' };
  } catch (err) {
    return {
      status: 'error',
      detail: err instanceof Error ? err.message : 'Sin conexión con Supabase.',
    };
  }
}

export async function fetchCloudProjects(userId: string): Promise<ClipProject[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('shortstudio_projects')
      .select('data')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    if (error || !data) return [];
    return data
      .map((row) => row.data as ClipProject)
      .filter((p) => Boolean(p && p.id));
  } catch {
    return [];
  }
}

export async function upsertCloudProject(userId: string, project: ClipProject): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from('shortstudio_projects').upsert({
      id: project.id,
      user_id: userId,
      data: project,
      updated_at: project.updatedAt || new Date().toISOString(),
    });
  } catch {
    // Graceful local-first fallback if optional cloud table is not created yet
  }
}

export async function deleteCloudProject(userId: string, projectId: string): Promise<void> {
  if (!supabase) return;
  try {
    await supabase
      .from('shortstudio_projects')
      .delete()
      .eq('user_id', userId)
      .eq('id', projectId);
  } catch {
    // ignore
  }
}

export async function fetchCloudScheduledPosts(userId: string): Promise<ScheduledPost[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('shortstudio_scheduled_posts')
      .select('data')
      .eq('user_id', userId)
      .order('scheduled_at', { ascending: true });
    if (error || !data) return [];
    return data
      .map((row) => row.data as ScheduledPost)
      .filter((p) => Boolean(p && p.id));
  } catch {
    return [];
  }
}

export async function upsertCloudScheduledPost(
  userId: string,
  post: ScheduledPost
): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from('shortstudio_scheduled_posts').upsert({
      id: post.id,
      user_id: userId,
      data: post,
      scheduled_at: post.scheduledAt || new Date().toISOString(),
    });
  } catch {
    // ignore
  }
}

export async function deleteCloudScheduledPost(userId: string, postId: string): Promise<void> {
  if (!supabase) return;
  try {
    await supabase
      .from('shortstudio_scheduled_posts')
      .delete()
      .eq('user_id', userId)
      .eq('id', postId);
  } catch {
    // ignore
  }
}

export async function fetchCloudAppSettings(userId: string): Promise<AppSettings | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('shortstudio_settings')
      .select('data')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data?.data) return null;
    return data.data as AppSettings;
  } catch {
    return null;
  }
}

export async function upsertCloudAppSettings(
  userId: string,
  settings: AppSettings
): Promise<void> {
  if (!supabase) return;
  try {
    // Never sync ephemeral local PC connector tokens across different machines
    const { localConnectorToken: _omit, ...syncable } = settings;
    await supabase.from('shortstudio_settings').upsert({
      user_id: userId,
      data: syncable,
      updated_at: new Date().toISOString(),
    });
  } catch {
    // ignore
  }
}
