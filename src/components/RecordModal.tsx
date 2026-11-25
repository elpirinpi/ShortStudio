import { useEffect, useRef, useState } from 'react';
import { AlertCircle, MonitorUp, Square, Video, X } from 'lucide-react';
import { formatTime } from '../utils/srt';

interface RecordModalProps {
  open: boolean;
  onClose: () => void;
  onSaveRecording: (file: File) => void;
}

export function RecordModal({ open, onClose, onSaveRecording }: RecordModalProps) {
  const [mode, setMode] = useState<'camera' | 'screen'>('camera');
  const [includeMic, setIncludeMic] = useState(true);
  const [recording, setRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState('');

  const previewRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);

  const stopTracks = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (previewRef.current) {
      previewRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    if (!open) {
      stopTracks();
      setRecording(false);
      setElapsedSec(0);
      setError('');
    }
    return () => stopTracks();
  }, [open]);

  if (!open) return null;

  const startRecording = async () => {
    setError('');
    chunksRef.current = [];
    setElapsedSec(0);

    try {
      let stream: MediaStream;
      if (mode === 'screen') {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: 30 },
          audio: true,
        });

        if (includeMic) {
          try {
            const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream = new MediaStream([
              ...displayStream.getVideoTracks(),
              ...displayStream.getAudioTracks(),
              ...micStream.getAudioTracks(),
            ]);
          } catch {
            stream = displayStream;
          }
        } else {
          stream = displayStream;
        }
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: 30 },
          audio: includeMic,
        });
      }

      streamRef.current = stream;
      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        previewRef.current.play().catch(() => {});
      }

      const mimeOptions = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4',
      ];
      const mimeType = mimeOptions.find((m) => MediaRecorder.isTypeSupported(m)) || '';
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 })
        : new MediaRecorder(stream);

      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blobType = recorder.mimeType || 'video/webm';
        const ext = blobType.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(chunksRef.current, { type: blobType });
        stopTracks();
        setRecording(false);
        if (blob.size > 0) {
          const file = new File(
            [blob],
            `Grabacion_${mode === 'screen' ? 'Pantalla' : 'Camara'}_${Date.now()}.${ext}`,
            { type: blobType }
          );
          onSaveRecording(file);
          onClose();
        }
      };

      // Handle browser "Stop sharing" button on screen capture
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          if (recorderRef.current && recorderRef.current.state !== 'inactive') {
            recorderRef.current.stop();
          }
        };
      }

      recorder.start(250);
      setRecording(true);
      const startedAt = Date.now();
      timerRef.current = window.setInterval(() => {
        setElapsedSec((Date.now() - startedAt) / 1000);
      }, 200);
    } catch (err) {
      stopTracks();
      setRecording(false);
      setError(
        err instanceof Error
          ? err.message
          : 'No se pudo acceder a la cámara, pantalla o micrófono.'
      );
    }
  };

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    } else {
      stopTracks();
      setRecording(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !recording) onClose();
      }}
    >
      <div className="w-full max-w-lg bg-[#12151c] border border-slate-800 rounded-xl p-5 flex flex-col gap-4 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-100">Grabar video local</h3>
            <p className="text-xs text-slate-400">
              Captura tu cámara o pantalla directamente en el navegador sin subidas externas.
            </p>
          </div>
          <button
            type="button"
            disabled={recording}
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#191d26] disabled:opacity-40 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 bg-[#0b0d11] p-1 rounded-lg border border-slate-800">
          <button
            type="button"
            disabled={recording}
            onClick={() => setMode('camera')}
            className={`inline-flex items-center justify-center gap-2 py-2 px-3 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              mode === 'camera'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Video className="w-3.5 h-3.5" />
            <span>Cámara Web</span>
          </button>
          <button
            type="button"
            disabled={recording}
            onClick={() => setMode('screen')}
            className={`inline-flex items-center justify-center gap-2 py-2 px-3 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              mode === 'screen'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <MonitorUp className="w-3.5 h-3.5" />
            <span>Pantalla</span>
          </button>
        </div>

        <div className="aspect-video w-full bg-[#0b0d11] border border-slate-800 rounded-lg overflow-hidden flex items-center justify-center relative">
          <video
            ref={previewRef}
            muted
            playsInline
            className="w-full h-full object-contain"
          />
          {!recording && (
            <span className="absolute text-xs text-slate-500 pointer-events-none">
              Vista previa en vivo al iniciar grabación
            </span>
          )}
          {recording && (
            <div className="absolute top-3 left-3 bg-black/75 border border-rose-500/40 px-2.5 py-1 rounded-md flex items-center gap-2 text-xs font-mono-tabular text-rose-300">
              <span>REC</span>
              <span>·</span>
              <span>{formatTime(elapsedSec)}</span>
            </div>
          )}
        </div>

        <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer">
          <span>Incluir audio del micrófono</span>
          <input
            type="checkbox"
            checked={includeMic}
            disabled={recording}
            onChange={(e) => setIncludeMic(e.target.checked)}
            className="w-4 h-4 accent-indigo-500 cursor-pointer"
          />
        </label>

        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex justify-end gap-2">
          {recording ? (
            <button
              type="button"
              onClick={stopRecording}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 cursor-pointer"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Detener y Usar Grabación</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={startRecording}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 cursor-pointer"
            >
              <Video className="w-3.5 h-3.5" />
              <span>Comenzar Grabación</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
