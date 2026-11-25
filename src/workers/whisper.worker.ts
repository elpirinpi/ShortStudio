import { pipeline, env } from '@huggingface/transformers';

// Ensure local browser cache is used and never looks for local server files
env.allowLocalModels = false;
env.useBrowserCache = true;

type WorkerRequest = {
  type: 'transcribe';
  audio: Float32Array;
  modelId: string;
  language: string;
};

type AsrChunk = {
  timestamp: [number, number | null];
  text: string;
};

type AsrOutput = {
  text: string;
  chunks?: AsrChunk[];
};

let cachedPipeline:
  | ((audio: Float32Array, options?: Record<string, unknown>) => Promise<AsrOutput>)
  | null = null;
let cachedModelId = '';

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const { type, audio, modelId, language } = event.data;
  if (type !== 'transcribe') return;

  try {
    if (!cachedPipeline || cachedModelId !== modelId) {
      self.postMessage({
        type: 'status',
        message: `Cargando modelo Whisper ${modelId.replace('Xenova/', '')} en caché local...`,
      });

      const asr = await pipeline('automatic-speech-recognition', modelId, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (info: { status?: string; progress?: number; file?: string }) => {
          if (info.status === 'progress' && typeof info.progress === 'number') {
            self.postMessage({
              type: 'progress',
              progress: Math.round(info.progress),
              message: `Descargando Whisper local (${Math.round(info.progress)}%)...`,
            });
          }
        },
      });

      cachedPipeline = asr as unknown as (
        audio: Float32Array,
        options?: Record<string, unknown>
      ) => Promise<AsrOutput>;
      cachedModelId = modelId;
    }

    self.postMessage({
      type: 'status',
      message: 'Transcribiendo voz localmente con Whisper...',
    });

    const baseOptions: Record<string, unknown> = {
      chunk_length_s: 30,
      stride_length_s: 5,
      task: 'transcribe',
    };
    if (language && language !== 'auto') {
      baseOptions.language = language;
    }

    let result: AsrOutput;
    try {
      result = await cachedPipeline(audio, {
        ...baseOptions,
        return_timestamps: 'word',
      });
    } catch {
      // Fallback to phrase/segment timestamps which all Whisper ONNX models support reliably
      result = await cachedPipeline(audio, {
        ...baseOptions,
        return_timestamps: true,
      });
    }

    // If word timestamps returned empty chunks despite text, retry with segment timestamps
    if ((!result.chunks || result.chunks.length === 0) && result.text?.trim()) {
      try {
        const segResult = await cachedPipeline(audio, {
          ...baseOptions,
          return_timestamps: true,
        });
        if (segResult.chunks && segResult.chunks.length > 0) {
          result = segResult;
        }
      } catch {
        // Keep original text result
      }
    }

    self.postMessage({
      type: 'result',
      text: result.text || '',
      chunks: result.chunks || [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error ejecutando Whisper local';
    self.postMessage({ type: 'error', message });
  }
});
