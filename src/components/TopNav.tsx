import { Download, LogOut, Plus } from 'lucide-react';
import { AppView } from '../types/editor';

interface TopNavProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  projectsCount: number;
  hasActiveProject: boolean;
  scheduledCount: number;
  onNewProject: () => void;
  onExportFromHeader: () => void;
  isExporting: boolean;
  canExport: boolean;
  userEmail?: string | null;
  onSignOut?: () => void;
}

export function TopNav({
  activeView,
  onNavigate,
  projectsCount,
  hasActiveProject,
  scheduledCount,
  onNewProject,
  onExportFromHeader,
  isExporting,
  canExport,
  userEmail,
  onSignOut,
}: TopNavProps) {
  const navItems: Array<{ id: AppView; label: string; count?: number; disabled?: boolean }> = [
    { id: 'create', label: 'Crear' },
    { id: 'projects', label: 'Proyectos', count: projectsCount },
    { id: 'results', label: 'Resultados', disabled: !hasActiveProject },
    { id: 'editor', label: 'Editor 9:16' },
    { id: 'scheduler', label: 'Programador', count: scheduledCount },
    { id: 'settings', label: 'Ajustes' },
  ];

  return (
    <header className="h-14 shrink-0 bg-[#12151c] border-b border-slate-800/90 px-5 flex items-center justify-between gap-6">
      <div className="flex items-baseline gap-2 min-w-0 shrink-0">
        <button
          type="button"
          onClick={() => onNavigate('create')}
          className="text-base font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
        >
          KellyClipAi Studio
        </button>
        <span className="hidden xl:inline text-[11px] text-slate-500 whitespace-nowrap">
          por Kelly Benjamin De La Cruz
        </span>
      </div>

      <nav className="flex items-center gap-6 overflow-x-auto" aria-label="Navegación principal">
        {navItems.map((item) => {
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              disabled={item.disabled}
              onClick={() => onNavigate(item.id)}
              className={`relative py-4 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
                isActive ? 'text-slate-100' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>{item.label}</span>
              {typeof item.count === 'number' && item.count > 0 && (
                <span className="ml-1.5 font-mono-tabular text-[11px] text-slate-400">
                  ({item.count})
                </span>
              )}
              {isActive && (
                <span className="absolute left-0 right-0 bottom-0 h-0.5 bg-indigo-500" />
              )}
            </button>
          );
        })}
      </nav>

      <div className="flex items-center gap-2 shrink-0">
        {userEmail && (
          <button
            type="button"
            onClick={onSignOut}
            title={`Cerrar sesión (${userEmail})`}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-300 bg-[#191d26] border border-slate-800 hover:bg-[#222733] whitespace-nowrap cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5 text-slate-400" />
            <span className="max-w-[140px] truncate">{userEmail}</span>
          </button>
        )}

        {activeView === 'editor' ? (
          <button
            type="button"
            onClick={onExportFromHeader}
            disabled={isExporting || !canExport}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Exportar 1080p</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onNewProject}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nuevo Proyecto</span>
          </button>
        )}
      </div>
    </header>
  );
}
