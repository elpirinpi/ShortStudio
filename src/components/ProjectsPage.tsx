import { useMemo, useState } from 'react';
import {
  Check,
  CopyPlus,
  FileVideo,
  FolderOpen,
  Pencil,
  Plus,
  Search,
  Scissors,
  Trash2,
  X,
} from 'lucide-react';
import { ClipProject } from '../types/editor';
import { formatTime } from '../utils/srt';

interface ProjectsPageProps {
  projects: ClipProject[];
  onOpenResults: (projectId: string) => void;
  onOpenEditor: (projectId: string, clipId?: string) => void;
  onRenameProject: (projectId: string, title: string) => void;
  onDuplicateProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onNewProject: () => void;
}

export function ProjectsPage({
  projects,
  onOpenResults,
  onOpenEditor,
  onRenameProject,
  onDuplicateProject,
  onDeleteProject,
  onNewProject,
}: ProjectsPageProps) {
  const [query, setQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'demo' | 'local'>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((p) => {
      if (filterMode === 'demo' && !p.isDemo) return false;
      if (filterMode === 'local' && p.isDemo) return false;
      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        p.clips.some((c) => c.title.toLowerCase().includes(q))
      );
    });
  }, [projects, query, filterMode]);

  const commitRename = (projectId: string) => {
    const clean = draftTitle.trim();
    if (clean) {
      onRenameProject(projectId, clean);
    }
    setEditingId(null);
  };

  return (
    <main className="flex-1 overflow-y-auto bg-[#0b0d12] p-6 sm:p-8">
      <div className="max-w-6xl mx-auto space-y-7">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.06] pb-5">
          <div className="space-y-1.5">
            <h1 className="text-xl font-bold tracking-tight text-white">Mis Proyectos</h1>
            <p className="text-xs text-slate-400">
              Todos tus videos, transcripciones y clips se conservan localmente en este navegador.
            </p>
          </div>
          <button
            type="button"
            onClick={onNewProject}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 cursor-pointer whitespace-nowrap transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nuevo Proyecto</span>
          </button>
        </div>

        {/* Search & Filter Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por título o clip..."
              className="w-full bg-[#12151c] border border-white/[0.06] rounded-xl pl-10 pr-3.5 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500/70"
            />
          </div>

          <div className="flex items-center gap-1 bg-[#12151c] p-1 rounded-xl">
            {(
              [
                { id: 'all', label: 'Todos' },
                { id: 'local', label: 'Videos subidos' },
                { id: 'demo', label: 'Demo' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterMode(tab.id)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors whitespace-nowrap ${
                  filterMode === tab.id
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="bg-[#12151c] border border-white/[0.06] rounded-2xl p-12 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-white/[0.04] flex items-center justify-center mx-auto">
              <FolderOpen className="w-5 h-5 text-slate-400" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-white">
                {projects.length === 0
                  ? 'Todavía no tienes proyectos guardados'
                  : 'Ningún proyecto coincide con tu búsqueda'}
              </p>
              <p className="text-xs text-slate-400">
                Importa o graba un video desde Crear para generar clips automáticamente.
              </p>
            </div>
            {projects.length === 0 && (
              <button
                type="button"
                onClick={onNewProject}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 cursor-pointer transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Crear Primer Proyecto</span>
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map((project) => {
              const isEditing = editingId === project.id;
              return (
                <article
                  key={project.id}
                  className="bg-[#12151c] border border-white/[0.06] hover:border-white/[0.12] transition-colors rounded-2xl overflow-hidden flex flex-col justify-between"
                >
                  <div>
                    <div className="aspect-video bg-[#0b0d12] relative flex items-center justify-center overflow-hidden">
                      {project.thumbnailDataUrl ? (
                        <img
                          src={project.thumbnailDataUrl}
                          alt={project.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="flex flex-col items-center gap-1.5 text-slate-500">
                          <FileVideo className="w-7 h-7" />
                          <span className="text-[11px]">
                            {project.isDemo ? 'Proyecto Demo' : `${project.width}×${project.height}`}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="p-5 space-y-2">
                      {isEditing ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={draftTitle}
                            autoFocus
                            onChange={(e) => setDraftTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename(project.id);
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                            className="flex-1 bg-[#0b0d12] border border-blue-500/70 rounded-lg px-2.5 py-1 text-xs text-slate-100 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => commitRename(project.id)}
                            className="p-1 rounded-md text-emerald-400 hover:bg-emerald-500/10 cursor-pointer"
                            title="Guardar nombre"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="p-1 rounded-md text-slate-400 hover:bg-white/[0.06] cursor-pointer"
                            title="Cancelar"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <h2 className="text-sm font-semibold text-white truncate">
                            {project.title}
                          </h2>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(project.id);
                              setDraftTitle(project.title);
                            }}
                            title="Renombrar proyecto"
                            className="p-1 rounded text-slate-500 hover:text-slate-200 cursor-pointer shrink-0"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono-tabular text-slate-400">
                        <span>{project.clips.length} clips</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatTime(project.duration)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{project.config.ratio}</span>
                      </div>
                      <p className="text-[11px] text-slate-500 truncate">{project.aiEngineUsed}</p>
                    </div>
                  </div>

                  <div className="px-5 py-3.5 border-t border-white/[0.06] flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenResults(project.id)}
                        className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 cursor-pointer whitespace-nowrap transition-colors"
                      >
                        Ver Clips
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenEditor(project.id, project.clips[0]?.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-200 bg-[#181c25] hover:bg-[#202633] cursor-pointer whitespace-nowrap transition-colors"
                      >
                        <Scissors className="w-3 h-3 text-blue-400" />
                        <span>Editor</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onDuplicateProject(project.id)}
                        title="Duplicar proyecto"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-white/[0.06] cursor-pointer transition-colors"
                      >
                        <CopyPlus className="w-3.5 h-3.5" />
                      </button>
                      {confirmDeleteId === project.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmDeleteId(null);
                              onDeleteProject(project.id);
                            }}
                            className="px-2 py-1 rounded-md text-[11px] font-semibold text-white bg-rose-600 hover:bg-rose-500 cursor-pointer"
                          >
                            Confirmar
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-1 rounded-md text-[11px] text-slate-300 bg-[#181c25] hover:bg-[#202633] cursor-pointer"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(project.id)}
                          title="Eliminar proyecto"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 cursor-pointer transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
