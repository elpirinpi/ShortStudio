import { useEffect, useRef, useState } from 'react';
import { Download, Mic, Square, X } from 'lucide-react';

export type ExportFormatOption = 'mp4-h264' | 'webm-fast';

interface ExportOptionsModalProps {
  open: boolean;
  dimensionsLabel: string;
  durationSec: number;
  hasWatermark: boolean;
  selectedFormat: ExportFormatOption;
  onSelectFormat: (fmt: ExportFormatOption) => void;
  onClose: () => void;
  onStartExport: (fmt: ExportFormatOption) => void;
}

export function ExportOptionsModal({
  open,
  dimensionsLabel,
  durationSec,
  hasWatermark,
  selectedFormat,
  onSelectFormat,
  onClose,
  onStartExport,
}: ExportOptionsModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md bg-[#12151c] border border-slate-800 rounded-xl p-5 flex flex-col gap-4 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-slate-100">Exportar Short Profesional</h3>
            <p className="text-xs font-mono-tabular text-slate-400">
              {dimensionsLabel} · {durationSec.toFixed(1)}s · 30fps
              {hasWatermark ? ' · Marca de agua activa' : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#191d26] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2">
          <button
            type="button"
            onClick={() => onSelectFormat('mp4-h264')}
            className={`w-full text-left p-3.5 rounded-lg border transition-colors cursor-pointer ${
              selectedFormat === 'mp4-h264'
                ? 'bg-indigo-600/15 border-indigo-500 text-slate-100'
                : 'bg-[#0b0d11] border-slate-800 text-slate-300 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between text-xs font-semibold">
              <span>MP4 Universal (H.264 + AAC)</span>
              <span className="text-[11px] font-medium text-indigo-400">Recomendado</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
              Compatible con TikTok, Instagram Reels, YouTube Shorts, iPhone y editores como
              CapCut o Premiere (transcodificado localmente con FFmpeg).
            </p>
          </button>

          <button
            type="button"
            onClick={() => onSelectFormat('webm-fast')}
            className={`w-full text-left p-3.5 rounded-lg border transition-colors cursor-pointer ${
              selectedFormat === 'webm-fast'
                ? 'bg-indigo-600/15 border-indigo-500 text-slate-100'
                : 'bg-[#0b0d11] border-slate-800 text-slate-300 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between text-xs font-semibold">
              <span>WebM Instantáneo (Solo Navegador)</span>
              <span className="text-[11px] font-medium text-slate-400">Sin conversión</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
              Descarga inmediata directamente desde el navegador sin paso de transcodificación.
            </p>
          </button>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-medium text-slate-300 bg-[#191d26] border border-slate-800 hover:bg-[#222733] cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onStartExport(selectedFormat)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Iniciar Renderizado</span>
          </button>
        </div>
      </div>
    </div>
  );
}

interface ExportModalProps {
  open: boolean;
  progress: number;
  statusText: string;
  dimensionsLabel?: string;
  onCancel: () => void;
}

export function ExportModal({
  open,
  progress,
  statusText,
  dimensionsLabel = '1080×1920',
  onCancel,
}: ExportModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-md bg-[#12151c] border border-slate-800 rounded-xl p-6 flex flex-col gap-4 shadow-2xl">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-slate-100">
            Renderizando Short ({dimensionsLabel})
          </h3>
          <p className="text-xs text-slate-400 leading-relaxed font-mono-tabular">{statusText}</p>
        </div>

        <div className="h-2.5 w-full bg-[#0b0d11] border border-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-500 transition-[width] duration-100 ease-linear"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-xs font-medium text-rose-300 bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/20 cursor-pointer"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

interface ScriptModalProps {
  open: boolean;
  onClose: () => void;
  onGenerate: (scriptText: string, wordsPerBlock: number) => void;
}

interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export function ScriptModal({ open, onClose, onGenerate }: ScriptModalProps) {
  const [text, setText] = useState('');
  const [wordsPerBlock, setWordsPerBlock] = useState(3);
  const [dictating, setDictating] = useState(false);
  const [dictationLang, setDictationLang] = useState('es-ES');
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);

  const SpeechCtor =
    typeof window !== 'undefined'
      ? (
          window as unknown as {
            SpeechRecognition?: new () => BrowserSpeechRecognition;
            webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
          }
        ).SpeechRecognition ||
        (
          window as unknown as {
            webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
          }
        ).webkitSpeechRecognition
      : undefined;

  useEffect(() => {
    if (!open && recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
      setDictating(false);
    }
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
    };
  }, [open]);

  if (!open) return null;

  const toggleDictation = () => {
    if (!SpeechCtor) return;
    if (dictating && recognitionRef.current) {
      recognitionRef.current.stop();
      setDictating(false);
      return;
    }

    const rec = new SpeechCtor();
    rec.lang = dictationLang;
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      let added = '';
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal && res[0]?.transcript) {
          added += `${res[0].transcript.trim()} `;
        }
      }
      if (added.trim()) {
        setText(added.trim());
      }
    };
    rec.onerror = () => setDictating(false);
    rec.onend = () => setDictating(false);

    recognitionRef.current = rec;
    rec.start();
    setDictating(true);
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-lg bg-[#12151c] border border-slate-800 rounded-xl p-6 flex flex-col gap-4 shadow-2xl">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-slate-100">
            Generar subtítulos desde guion o dictado
          </h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Pega tu texto o díctalo con tu micrófono para dividirlo automáticamente dentro del
            rango de recorte actual.
          </p>
        </div>

        {SpeechCtor && (
          <div className="flex items-center justify-between gap-2 bg-[#0b0d11] border border-slate-800 rounded-lg p-2.5">
            <select
              value={dictationLang}
              disabled={dictating}
              onChange={(e) => setDictationLang(e.target.value)}
              className="bg-[#12151c] border border-slate-800 rounded-md px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="es-ES">Dictar en Español</option>
              <option value="en-US">Dictar en Inglés</option>
              <option value="pt-BR">Dictar en Portugués</option>
            </select>
            <button
              type="button"
              onClick={toggleDictation}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                dictating
                  ? 'bg-rose-600 hover:bg-rose-500 text-white'
                  : 'bg-[#191d26] border border-slate-800 text-slate-200 hover:bg-[#222733]'
              }`}
            >
              {dictating ? <Square className="w-3 h-3 fill-current" /> : <Mic className="w-3.5 h-3.5 text-indigo-400" />}
              <span>{dictating ? 'Detener Dictado' : 'Dictar con Micrófono'}</span>
            </button>
          </div>
        )}

        <textarea
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ej: ¿Sabías que el 80% de las personas desliza en los primeros 2 segundos? Por eso necesitas subtítulos dinámicos que retengan la atención."
          className="w-full bg-[#0b0d11] border border-slate-800 rounded-lg p-3 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 resize-y"
        />

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-slate-300">Palabras por bloque</span>
          <select
            value={wordsPerBlock}
            onChange={(e) => setWordsPerBlock(Number(e.target.value))}
            className="w-full bg-[#0b0d11] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
          >
            <option value={2}>2 palabras (Ritmo rápido / Hormozi)</option>
            <option value={3}>3 palabras (Equilibrado)</option>
            <option value={4}>4 palabras (Lectura cómoda)</option>
            <option value={6}>6 palabras (Frases completas)</option>
          </select>
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              if (recognitionRef.current) {
                recognitionRef.current.stop();
                setDictating(false);
              }
              onClose();
            }}
            className="px-4 py-2 rounded-lg text-xs font-medium text-slate-300 bg-[#191d26] border border-slate-800 hover:bg-[#222733] cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => {
              if (!text.trim()) return;
              if (recognitionRef.current) {
                recognitionRef.current.stop();
                setDictating(false);
              }
              onGenerate(text, wordsPerBlock);
              setText('');
            }}
            className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 cursor-pointer"
          >
            Generar Subtítulos
          </button>
        </div>
      </div>
    </div>
  );
}
