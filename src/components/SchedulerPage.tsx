import React, { useMemo, useState } from 'react';
import { Calendar, CheckCircle2, Copy, Download, Scissors, Trash2 } from 'lucide-react';
import { ClipProject, ScheduledPost, SocialPlatform } from '../types/editor';
import { exportSubtitlesToSRT } from '../utils/srt';

interface SchedulerPageProps {
  projects: ClipProject[];
  posts: ScheduledPost[];
  initialProjectId?: string | null;
  initialClipId?: string | null;
  onCreatePost: (post: ScheduledPost) => void;
  onUpdatePostStatus: (id: string, status: ScheduledPost['status']) => void;
  onDeletePost: (id: string) => void;
  onOpenClipInEditor: (projectId: string, clipId: string) => void;
  onNotify: (msg: string) => void;
}

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  youtube_shorts: 'YouTube Shorts',
  tiktok: 'TikTok',
  instagram_reels: 'Instagram Reels',
};

const STATUS_LABELS: Record<ScheduledPost['status'], string> = {
  scheduled: 'Programado',
  ready: 'Listo para subir',
  published: 'Publicado',
};

export function SchedulerPage({
  projects,
  posts,
  initialProjectId,
  initialClipId,
  onCreatePost,
  onUpdatePostStatus,
  onDeletePost,
  onOpenClipInEditor,
  onNotify,
}: SchedulerPageProps) {
  const defaultProject =
    projects.find((p) => p.id === initialProjectId) || projects[0] || null;
  const defaultClip =
    defaultProject?.clips.find((c) => c.id === initialClipId) ||
    defaultProject?.clips[0] ||
    null;

  const [selectedProjectId, setSelectedProjectId] = useState<string>(defaultProject?.id || '');
  const [selectedClipId, setSelectedClipId] = useState<string>(defaultClip?.id || '');
  const [platform, setPlatform] = useState<SocialPlatform>('youtube_shorts');
  const [scheduledAt, setScheduledAt] = useState(() => {
    const d = new Date(Date.now() + 3600 * 1000 * 4);
    d.setMinutes(0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
      d.getHours()
    )}:00`;
  });
  const [caption, setCaption] = useState(defaultClip?.title || '');
  const [hashtags, setHashtags] = useState(
    defaultClip ? defaultClip.keywords.map((k) => `#${k}`).join(' ') : '#shorts #viral'
  );
  const [visibility, setVisibility] = useState<'public' | 'unlisted' | 'private'>('public');
  const [platformFilter, setPlatformFilter] = useState<'all' | SocialPlatform>('all');

  const activeProject = projects.find((p) => p.id === selectedProjectId) || projects[0] || null;
  const activeClip =
    activeProject?.clips.find((c) => c.id === selectedClipId) ||
    activeProject?.clips[0] ||
    null;

  const filteredPosts = useMemo(() => {
    return posts.filter((p) => platformFilter === 'all' || p.platform === platformFilter);
  }, [posts, platformFilter]);

  const handleProjectSelect = (pid: string) => {
    setSelectedProjectId(pid);
    const proj = projects.find((p) => p.id === pid);
    const firstClip = proj?.clips[0];
    if (firstClip) {
      setSelectedClipId(firstClip.id);
      setCaption(firstClip.title);
      setHashtags(firstClip.keywords.map((k) => `#${k}`).join(' '));
    }
  };

  const handleClipSelect = (cid: string) => {
    setSelectedClipId(cid);
    const clip = activeProject?.clips.find((c) => c.id === cid);
    if (clip) {
      setCaption(clip.title);
      setHashtags(clip.keywords.map((k) => `#${k}`).join(' '));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProject || !activeClip) {
      onNotify('Primero genera al menos un clip para programarlo');
      return;
    }

    const newPost: ScheduledPost = {
      id: `post_${Date.now()}`,
      projectId: activeProject.id,
      clipId: activeClip.id,
      projectTitle: activeProject.title,
      clipTitle: caption.trim() || activeClip.title,
      platform,
      scheduledAt,
      caption: caption.trim() || activeClip.title,
      hashtags: hashtags.trim(),
      visibility,
      status: 'scheduled',
    };
    onCreatePost(newPost);
    onNotify('Publicación añadida al calendario');
  };

  const copyPostText = async (post: ScheduledPost) => {
    const full = `${post.caption}\n\n${post.hashtags}`.trim();
    try {
      await navigator.clipboard.writeText(full);
      onNotify('Título y hashtags copiados');
    } catch {
      onNotify('No se pudo copiar al portapapeles');
    }
  };

  const downloadPostSrt = (post: ScheduledPost) => {
    const proj = projects.find((p) => p.id === post.projectId);
    const clip = proj?.clips.find((c) => c.id === post.clipId);
    if (!clip || clip.subtitles.length === 0) {
      onNotify('Este clip no tiene subtítulos para exportar');
      return;
    }
    const content = exportSubtitlesToSRT(clip.subtitles);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${post.clipTitle.slice(0, 24).replace(/\s+/g, '_')}.srt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const exportQueueCsv = () => {
    if (filteredPosts.length === 0) return;
    const escapeCsv = (val: string) => `"${String(val).replace(/"/g, '""')}"`;
    const rows = [
      ['Fecha', 'Plataforma', 'Estado', 'Visibilidad', 'Proyecto', 'Titulo', 'Hashtags'].join(','),
      ...filteredPosts.map((p) =>
        [
          escapeCsv(p.scheduledAt.replace('T', ' ')),
          escapeCsv(PLATFORM_LABELS[p.platform]),
          escapeCsv(STATUS_LABELS[p.status]),
          escapeCsv(p.visibility),
          escapeCsv(p.projectTitle),
          escapeCsv(p.caption),
          escapeCsv(p.hashtags),
        ].join(',')
      ),
    ];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `KellyClipAi_Calendario_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    onNotify('Calendario exportado en .CSV');
  };

  const exportQueueIcs = () => {
    if (filteredPosts.length === 0) return;
    const toIcsDate = (isoLocal: string) => {
      const dt = new Date(isoLocal);
      if (Number.isNaN(dt.getTime())) return '20260101T120000Z';
      return dt.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    };
    const events = filteredPosts.map((p) => {
      const start = toIcsDate(p.scheduledAt);
      const endDate = new Date(new Date(p.scheduledAt).getTime() + 15 * 60 * 1000);
      const end = Number.isNaN(endDate.getTime())
        ? start
        : endDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      const summary = `[${PLATFORM_LABELS[p.platform]}] ${p.clipTitle}`.replace(/\n/g, ' ');
      const desc = `${p.caption}\\n${p.hashtags}\\nProyecto: ${p.projectTitle}`.replace(/\n/g, '\\n');
      return [
        'BEGIN:VEVENT',
        `UID:${p.id}@kellyclipai.local`,
        `DTSTAMP:${toIcsDate(new Date().toISOString())}`,
        `DTSTART:${start}`,
        `DTEND:${end}`,
        `SUMMARY:${summary}`,
        `DESCRIPTION:${desc}`,
        'END:VEVENT',
      ].join('\r\n');
    });
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//KellyClipAi Studio//ES',
      ...events,
      'END:VCALENDAR',
    ].join('\r\n');
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `KellyClipAi_Calendario_${Date.now()}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    onNotify('Eventos exportados en .ICS (Google/Apple Calendar)');
  };

  return (
    <main className="flex-1 overflow-y-auto bg-[#0b0d12] p-6 sm:p-8">
      <div className="max-w-6xl mx-auto space-y-7">
        <div className="border-b border-white/[0.06] pb-5 space-y-1.5">
          <h1 className="text-xl font-bold tracking-tight text-white">
            Programador de Publicaciones
          </h1>
          <p className="text-xs text-slate-400">
            Organiza fechas, copias y hashtags para YouTube Shorts, TikTok e Instagram Reels con
            acceso directo a la exportación 1080p.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">
          {/* Schedule Form */}
          <form
            onSubmit={handleSubmit}
            className="lg:col-span-5 bg-[#12151c] border border-white/[0.06] rounded-2xl p-6 space-y-4"
          >
            <h2 className="text-sm font-semibold text-white">Programar nuevo clip</h2>

            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-slate-400">Proyecto</span>
              <select
                value={activeProject?.id || ''}
                onChange={(e) => handleProjectSelect(e.target.value)}
                className="bg-[#0b0d12] border border-white/[0.06] rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500/70"
              >
                {projects.length === 0 ? (
                  <option value="">Sin proyectos disponibles</option>
                ) : (
                  projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))
                )}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-slate-400">Clip</span>
              <select
                value={activeClip?.id || ''}
                onChange={(e) => handleClipSelect(e.target.value)}
                className="bg-[#0b0d12] border border-white/[0.06] rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500/70"
              >
                {!activeProject || activeProject.clips.length === 0 ? (
                  <option value="">Sin clips</option>
                ) : (
                  activeProject.clips.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title} ({c.score}/100)
                    </option>
                  ))
                )}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] text-slate-400">Plataforma</span>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value as SocialPlatform)}
                  className="bg-[#0b0d12] border border-white/[0.06] rounded-xl px-2.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500/70"
                >
                  <option value="youtube_shorts">YouTube Shorts</option>
                  <option value="tiktok">TikTok</option>
                  <option value="instagram_reels">Instagram Reels</option>
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] text-slate-400">Visibilidad</span>
                <select
                  value={visibility}
                  onChange={(e) =>
                    setVisibility(e.target.value as 'public' | 'unlisted' | 'private')
                  }
                  className="bg-[#0b0d12] border border-white/[0.06] rounded-xl px-2.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500/70"
                >
                  <option value="public">Público</option>
                  <option value="unlisted">Oculto</option>
                  <option value="private">Privado</option>
                </select>
              </label>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-slate-400">Fecha y hora</span>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="bg-[#0b0d12] border border-white/[0.06] rounded-xl px-3 py-2 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-blue-500/70"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-slate-400">Título / Descripción</span>
              <textarea
                rows={2}
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Título gancho para el Short..."
                className="bg-[#0b0d12] border border-white/[0.06] rounded-xl p-2.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500/70 resize-y"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-slate-400">Hashtags</span>
              <input
                type="text"
                value={hashtags}
                onChange={(e) => setHashtags(e.target.value)}
                placeholder="#shorts #tiktok #edicion"
                className="bg-[#0b0d12] border border-white/[0.06] rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500/70"
              />
            </label>

            <button
              type="submit"
              disabled={!activeProject || !activeClip}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-45 cursor-pointer transition-colors"
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Añadir al Calendario</span>
            </button>
          </form>

          {/* Scheduled Queue */}
          <div className="lg:col-span-7 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-200">
                Cola programada ({filteredPosts.length})
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                {filteredPosts.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={exportQueueCsv}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium text-slate-200 bg-[#12151c] border border-white/[0.06] hover:bg-[#181c25] cursor-pointer whitespace-nowrap transition-colors"
                    >
                      <Download className="w-3 h-3 text-slate-400" />
                      <span>.CSV</span>
                    </button>
                    <button
                      type="button"
                      onClick={exportQueueIcs}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium text-slate-200 bg-[#12151c] border border-white/[0.06] hover:bg-[#181c25] cursor-pointer whitespace-nowrap transition-colors"
                    >
                      <Calendar className="w-3 h-3 text-blue-400" />
                      <span>.ICS</span>
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-1 bg-[#12151c] p-1 rounded-xl">
                  {(
                    [
                      { id: 'all', label: 'Todas' },
                      { id: 'youtube_shorts', label: 'Shorts' },
                      { id: 'tiktok', label: 'TikTok' },
                      { id: 'instagram_reels', label: 'Reels' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setPlatformFilter(tab.id)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium cursor-pointer whitespace-nowrap transition-colors ${
                        platformFilter === tab.id
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-400 hover:text-slate-100'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {filteredPosts.length === 0 ? (
              <div className="bg-[#12151c] border border-white/[0.06] rounded-2xl p-12 text-center space-y-2">
                <p className="text-sm font-semibold text-white">
                  No hay publicaciones en cola
                </p>
                <p className="text-xs text-slate-400">
                  Selecciona un clip a la izquierda para programar tu próximo Short o TikTok.
                </p>
              </div>
            ) : (
              <div className="space-y-3.5">
                {filteredPosts.map((post) => (
                  <article
                    key={post.id}
                    className="bg-[#12151c] border border-white/[0.06] hover:border-white/[0.1] transition-colors rounded-2xl p-5 space-y-3.5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                          <span className="font-semibold text-blue-400">
                            {PLATFORM_LABELS[post.platform]}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono-tabular">
                            {post.scheduledAt.replace('T', ' ')}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span
                            className={
                              post.status === 'published'
                                ? 'text-emerald-400'
                                : post.status === 'ready'
                                ? 'text-amber-300'
                                : 'text-slate-300'
                            }
                          >
                            {STATUS_LABELS[post.status]}
                          </span>
                        </div>
                        <h3 className="text-sm font-semibold text-white">{post.clipTitle}</h3>
                        <p className="text-xs text-slate-400">{post.hashtags}</p>
                      </div>

                      <select
                        value={post.status}
                        onChange={(e) =>
                          onUpdatePostStatus(
                            post.id,
                            e.target.value as ScheduledPost['status']
                          )
                        }
                        className="bg-[#0b0d12] border border-white/[0.06] rounded-xl px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500/70"
                      >
                        <option value="scheduled">Programado</option>
                        <option value="ready">Listo para subir</option>
                        <option value="published">Publicado</option>
                      </select>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-white/[0.06]">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onOpenClipInEditor(post.projectId, post.clipId)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-slate-200 bg-[#181c25] hover:bg-[#222836] cursor-pointer transition-colors"
                        >
                          <Scissors className="w-3 h-3 text-blue-400" />
                          <span>Exportar Video</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => copyPostText(post)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-slate-200 bg-[#181c25] hover:bg-[#222836] cursor-pointer transition-colors"
                        >
                          <Copy className="w-3 h-3 text-slate-400" />
                          <span>Copiar Texto</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadPostSrt(post)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-slate-200 bg-[#181c25] hover:bg-[#222836] cursor-pointer transition-colors"
                        >
                          <Download className="w-3 h-3 text-slate-400" />
                          <span>.SRT</span>
                        </button>
                        {post.status !== 'published' && (
                          <button
                            type="button"
                            onClick={() => onUpdatePostStatus(post.id, 'published')}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-emerald-300 bg-emerald-500/12 border border-emerald-500/25 hover:bg-emerald-500/20 cursor-pointer transition-colors"
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Marcar Publicado</span>
                          </button>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => onDeletePost(post.id)}
                        title="Eliminar publicación"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 cursor-pointer transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
