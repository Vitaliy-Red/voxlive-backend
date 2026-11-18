import { Download, Mic, Trash2 } from "lucide-react";
import { SynthesizedClip } from "../types/voice";

interface ClipLibraryProps {
  clips: SynthesizedClip[];
  onDeleteClip: (id: string) => void;
  onGoToSynthesis: () => void;
}

const MODE_LABELS: Record<SynthesizedClip["mode"], string> = {
  live: "Живой эфир",
  tts: "Синтез текста",
  dialogue: "Два диктора",
};

export function ClipLibrary({
  clips,
  onDeleteClip,
  onGoToSynthesis,
}: ClipLibraryProps) {
  if (clips.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-12 text-center max-w-2xl mx-auto">
        <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center mx-auto mb-4">
          <Mic className="w-5 h-5" />
        </div>
        <h2 className="text-lg font-semibold text-slate-900">
          Записей пока нет
        </h2>
        <p className="text-sm text-slate-500 mt-1.5 max-w-md mx-auto leading-relaxed">
          Сохраняйте голосовые ответы из сессий Gemini Live или синтезируйте
          озвучку в разделе «Синтез текста» — все дорожки появятся здесь в
          формате WAV.
        </p>
        <div className="mt-6">
          <button
            type="button"
            onClick={onGoToSynthesis}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Перейти к синтезу
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Библиотека аудиозаписей
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Все синтезированные дорожки текущей сессии · 24 кГц PCM WAV
          </p>
        </div>
        <span className="text-xs font-mono tabular-nums text-slate-500">
          {clips.length} {clips.length === 1 ? "файл" : "файлов"}
        </span>
      </div>

      <div className="divide-y divide-slate-100">
        {clips.map((clip) => (
          <div
            key={clip.id}
            className="px-6 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-slate-50/70 transition-colors"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-900">
                  {clip.title}
                </span>
                <span aria-hidden="true" className="text-slate-300">
                  ·
                </span>
                <span className="text-xs text-slate-500">
                  {MODE_LABELS[clip.mode]}
                </span>
                <span aria-hidden="true" className="text-slate-300">
                  ·
                </span>
                <span className="text-xs font-mono text-slate-500">
                  {clip.model}
                </span>
                <span aria-hidden="true" className="text-slate-300">
                  ·
                </span>
                <span className="text-xs font-mono tabular-nums text-slate-500">
                  {clip.durationSec.toFixed(1)} сек · {clip.createdAt}
                </span>
              </div>
              <p className="text-xs text-slate-600 truncate max-w-2xl">
                {clip.textPreview}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <audio
                controls
                src={clip.audioUrl}
                className="h-9 w-64 max-w-full"
              />
              <a
                href={clip.audioUrl}
                download={`voxlive-${clip.id}.wav`}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                WAV
              </a>
              <button
                type="button"
                onClick={() => onDeleteClip(clip.id)}
                aria-label="Удалить запись"
                className="p-2 text-slate-400 hover:text-red-600 rounded-lg transition-colors cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
