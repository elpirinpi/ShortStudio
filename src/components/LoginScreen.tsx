import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Film,
  KeyRound,
  LoaderCircle,
  Lock,
  LogIn,
  Mail,
  UserPlus,
} from 'lucide-react';
import {
  hasSupabaseKey,
  hasSupabaseUrl,
  isSupabaseConfigured,
  supabase,
  translateSupabaseError,
} from '../lib/supabase';

const REMEMBER_FLAG_KEY = 'shortstudio.rememberCredentials';
const REMEMBER_EMAIL_KEY = 'shortstudio.rememberedEmail';

interface BrowserPasswordCredential extends Credential {
  id: string;
  password?: string;
}

type BrowserPasswordCredentialCtor = new (data: {
  id: string;
  password: string;
  name?: string;
}) => Credential;

export function LoginScreen() {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login');
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem(REMEMBER_EMAIL_KEY) || '';
    } catch {
      return '';
    }
  });
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_FLAG_KEY);
      if (saved === 'false') return false;
      if (saved === 'true') return true;
      return Boolean(window.shortStudioDesktop?.isDesktop);
    } catch {
      return false;
    }
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const isDesktopApp = Boolean(window.shortStudioDesktop?.isDesktop);

  useEffect(() => {
    let active = true;
    const loadSavedCredentials = async () => {
      try {
        if (window.shortStudioDesktop?.getRememberedCredentials) {
          const saved = await window.shortStudioDesktop.getRememberedCredentials();
          if (!active) return;
          if (saved.email) {
            setEmail((prev) => prev || saved.email);
            if (saved.password) {
              setPassword((prev) => prev || saved.password);
            }
            setRememberMe(true);
          }
          return;
        }

        if (typeof navigator !== 'undefined' && navigator.credentials?.get) {
          const cred = (await navigator.credentials.get({
            password: true,
            mediation: 'silent',
          } as CredentialRequestOptions)) as BrowserPasswordCredential | null;
          if (!active || !cred) return;
          if (cred.id) {
            setEmail((prev) => prev || cred.id);
          }
          if (cred.password) {
            setPassword((prev) => prev || cred.password || '');
            setRememberMe(true);
          }
        }
      } catch {
        // Ignore browser credential silent read errors
      }
    };
    void loadSavedCredentials();
    return () => {
      active = false;
    };
  }, []);

  const persistCredentialsChoice = async (cleanEmail: string, rawPassword: string) => {
    try {
      if (rememberMe) {
        localStorage.setItem(REMEMBER_FLAG_KEY, 'true');
        localStorage.setItem(REMEMBER_EMAIL_KEY, cleanEmail);
        if (window.shortStudioDesktop?.saveRememberedCredentials) {
          await window.shortStudioDesktop.saveRememberedCredentials({
            email: cleanEmail,
            password: rawPassword,
          });
        } else if (
          typeof window !== 'undefined' &&
          'PasswordCredential' in window &&
          navigator.credentials?.store
        ) {
          const Ctor = (
            window as unknown as { PasswordCredential?: BrowserPasswordCredentialCtor }
          ).PasswordCredential;
          if (Ctor) {
            const cred = new Ctor({ id: cleanEmail, password: rawPassword, name: cleanEmail });
            await navigator.credentials.store(cred).catch(() => {});
          }
        }
      } else {
        localStorage.setItem(REMEMBER_FLAG_KEY, 'false');
        localStorage.removeItem(REMEMBER_EMAIL_KEY);
        await window.shortStudioDesktop?.clearRememberedCredentials?.();
      }
    } catch {
      // Ignore storage failures
    }
  };

  const handleToggleRememberMe = (checked: boolean) => {
    setRememberMe(checked);
    try {
      localStorage.setItem(REMEMBER_FLAG_KEY, checked ? 'true' : 'false');
      if (!checked) {
        localStorage.removeItem(REMEMBER_EMAIL_KEY);
        void window.shortStudioDesktop?.clearRememberedCredentials?.();
      }
    } catch {
      // ignore
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !isSupabaseConfigured || loading) return;

    const cleanEmail = email.trim();
    if (!cleanEmail || (mode !== 'reset' && !password)) {
      setErrorMsg('Completa tu correo electrónico y contraseña.');
      return;
    }

    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
          redirectTo: window.location.origin,
        });
        if (error) {
          setErrorMsg(translateSupabaseError(error.message));
        } else {
          setSuccessMsg(
            'Te enviamos un enlace de recuperación a tu correo electrónico.'
          );
          setMode('login');
        }
      } else if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (error) {
          setErrorMsg(translateSupabaseError(error.message));
        } else {
          await persistCredentialsChoice(cleanEmail, password);
        }
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
        });
        if (error) {
          setErrorMsg(translateSupabaseError(error.message));
        } else {
          await persistCredentialsChoice(cleanEmail, password);
          if (!data.session) {
            setSuccessMsg(
              'Cuenta creada en Supabase. Revisa tu bandeja de correo para confirmar tu cuenta y luego inicia sesión.'
            );
            setMode('login');
          }
        }
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? translateSupabaseError(err.message) : 'No se pudo conectar con Supabase.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-screen bg-[#0b0d11] text-slate-100 flex flex-col justify-between p-6 overflow-y-auto">
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-md bg-[#12151c] border border-slate-800/90 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6">
          <div className="flex flex-col items-center text-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center">
              <Film className="w-6 h-6 text-indigo-400" />
            </div>
            <div className="space-y-1">
              <h1 className="text-xl font-bold tracking-tight text-slate-100">
                KellyClipAi Studio
              </h1>
              <p className="text-xs text-slate-400">
                Inicia sesión con tu cuenta de Supabase para acceder al estudio de Shorts 9:16
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5 bg-[#0b0d11] p-1 rounded-lg border border-slate-800">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setErrorMsg('');
                setSuccessMsg('');
              }}
              className={`inline-flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                mode === 'login'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Iniciar Sesión</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup');
                setErrorMsg('');
                setSuccessMsg('');
              }}
              className={`inline-flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                mode === 'signup'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Crear Cuenta</span>
            </button>
          </div>

          {!isSupabaseConfigured && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 leading-relaxed">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
              <span>
                {!hasSupabaseUrl && hasSupabaseKey
                  ? 'Falta la URL de tu proyecto Supabase (VITE_SUPABASE_URL, por ejemplo https://tu-proyecto.supabase.co) en tus secretos o archivo .env.'
                  : 'Para activar el acceso con Supabase, define VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY (o VITE_SUPABASE_ANON_KEY) en los Secretos de la app o en tu archivo .env.'}
              </span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-300">Correo electrónico</span>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  name="email"
                  autoComplete="username email"
                  required
                  value={email}
                  disabled={!isSupabaseConfigured || loading}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@correo.com"
                  className="w-full bg-[#0b0d11] border border-slate-800 rounded-lg pl-9 pr-3 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                />
              </div>
            </label>

            {mode !== 'reset' && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-300">Contraseña</span>
                  {mode === 'login' && isSupabaseConfigured && (
                    <button
                      type="button"
                      onClick={() => {
                        setMode('reset');
                        setErrorMsg('');
                        setSuccessMsg('');
                      }}
                      className="text-[11px] text-indigo-400 hover:text-indigo-300 cursor-pointer"
                    >
                      ¿Olvidaste tu contraseña?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    required
                    minLength={6}
                    value={password}
                    disabled={!isSupabaseConfigured || loading}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    className="w-full bg-[#0b0d11] border border-slate-800 rounded-lg pl-9 pr-9 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 cursor-pointer"
                    aria-label="Mostrar u ocultar contraseña"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}

            {mode !== 'reset' && (
              <div className="flex items-center justify-between gap-2 text-xs text-slate-300 select-none">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    disabled={!isSupabaseConfigured || loading}
                    onChange={(e) => handleToggleRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded accent-indigo-500 cursor-pointer"
                  />
                  <span>Recordar mis credenciales</span>
                </label>
                <div className="flex items-center gap-2">
                  {(email.trim() || password) && (
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => {
                        handleToggleRememberMe(false);
                        setEmail('');
                        setPassword('');
                        setSuccessMsg('Credenciales guardadas eliminadas de este equipo.');
                      }}
                      className="text-[11px] text-rose-400 hover:text-rose-300 cursor-pointer"
                    >
                      Olvidar
                    </button>
                  )}
                  <span className="text-[11px] text-slate-500">
                    {isDesktopApp ? 'Cifrado Windows' : 'Gestor seguro'}
                  </span>
                </div>
              </div>
            )}

            {errorMsg && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                <span>{errorMsg}</span>
              </div>
            )}

            {successMsg && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
                <span>{successMsg}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={!isSupabaseConfigured || loading}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {loading ? (
                <LoaderCircle className="w-3.5 h-3.5 animate-spin" />
              ) : mode === 'reset' ? (
                <KeyRound className="w-3.5 h-3.5" />
              ) : null}
              <span>
                {mode === 'login'
                  ? 'Iniciar Sesión con Supabase'
                  : mode === 'signup'
                  ? 'Registrar Cuenta en Supabase'
                  : 'Enviar enlace de recuperación'}
              </span>
            </button>

            {mode === 'reset' && (
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setErrorMsg('');
                }}
                className="w-full text-center text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                Volver a iniciar sesión
              </button>
            )}
          </form>
        </div>
      </div>

      <footer className="pt-4 text-center text-[11px] text-slate-500">
        KellyClipAi Studio · Desarrollado por{' '}
        <span className="text-slate-300 font-medium">Kelly Benjamin De La Cruz</span>
      </footer>
    </div>
  );
}
