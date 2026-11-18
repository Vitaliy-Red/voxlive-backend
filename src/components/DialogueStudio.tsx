import { useState } from "react";
import { Download, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import {
  DialogueLine,
  SynthesizedClip,
  VOICE_PROFILES,
  VoiceName,
} from "../types/voice";
import {
  createWavBlobFromBase64,
  getWavDurationSeconds,
} from "../utils/audio";
import { getApiUrl } from "../utils/api";

interface DialogueStudioProps {
  onSaveClip: (clip: SynthesizedClip) => void;
}

const INITIAL_LINES: DialogueLine[] = [
  {
    id: "line-1",
    speakerSlot: "A",
    text: "Всем привет! <breath> Сегодня тестируем двухголосый синтез речи с живыми паузами и реакциями.",
  },
  {
    id: "line-2",
    speakerSlot: "B",
    text: "|yeah| Звучит очень естественно! Особенно переходы между репликами и интонации.",
  },
  {
    id: "line-3",
    speakerSlot: "A",
    text: "Можно задать собственный тембр и характер для каждого участника диалога <laugh> и сразу выгрузить WAV.",
  },
];

export function DialogueStudio({ onSaveClip }: DialogueStudioProps) {
  const [speakerAName, setSpeakerAName] = useState("Артём");
  const [speakerAVoice, setSpeakerAVoice] = useState<VoiceName>("Puck");
  const [speakerAStyle, setSpeakerAStyle] = useState(
    "Энергичный ведущий подкаста, живая подача"
  );

  const [speakerBName, setSpeakerBName] = useState("Елена");
  const [speakerBVoice, setSpeakerBVoice] = useState<VoiceName>("Kore");
  const [speakerBStyle, setSpeakerBStyle] = useState(
    "Вдумчивый и доброжелательный соведущий"
  );

  const [lines, setLines] = useState<DialogueLine[]>(INITIAL_LINES);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [latestClip, setLatestClip] = useState<SynthesizedClip | null>(null);

  const addLine = (speakerSlot: "A" | "B") => {
    setLines((prev) => [
      ...prev,
      {
        id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        speakerSlot,
        text: "",
      },
    ]);
  };

  const updateLine = (
    id: string,
    patch: Partial<Pick<DialogueLine, "speakerSlot" | "text">>
  ) => {
    setLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, ...patch } : l))
    );
  };

  const removeLine = (id: string) => {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));
  };

  const handleSynthesizeDialogue = async (e: React.FormEvent) => {
    e.preventDefault();
    const validLines = lines.filter((l) => l.text.trim().length > 0);
    if (validLines.length === 0) {
      setErrorMsg("Добавьте хотя бы одну непустую реплику.");
      return;
    }

    setErrorMsg(null);
    setIsGenerating(true);

    try {
      const res = await fetch(getApiUrl("/api/tts"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "dialogue",
          model: "gemini-3.8-flash-tts",
          speakerAName,
          speakerAVoice,
          speakerAStyle,
          speakerBName,
          speakerBVoice,
          speakerBStyle,
          dialogueLines: validLines,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Ошибка синтеза диалога.");
      }

      const blob = createWavBlobFromBase64(data.audioBase64);
      const url = URL.createObjectURL(blob);
      const durationSec = await getWavDurationSeconds(blob);

      const clip: SynthesizedClip = {
        id: `dialogue-${Date.now()}`,
        title: `Диалог · ${speakerAName} и ${speakerBName}`,
        mode: "dialogue",
        voiceLabel: `${speakerAVoice} / ${speakerBVoice}`,
        model: "gemini-3.8-flash-tts",
        textPreview: validLines.map((l) => l.text).join(" "),
        audioUrl: url,
        durationSec,
        createdAt: new Date().toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };

      setLatestClip(clip);
      onSaveClip(clip);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Не удалось синтезировать диалог."
      );
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Speakers Config Sidebar */}
      <aside className="lg:col-span-4 space-y-5">
        {/* Speaker A */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3.5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Диктор 1</h2>
            <span className="text-xs font-mono text-slate-500">Слот A</span>
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="speaker-a-name"
              className="block text-xs font-medium text-slate-700"
            >
              Имя в сценарии
            </label>
            <input
              id="speaker-a-name"
              type="text"
              value={speakerAName}
              onChange={(e) => setSpeakerAName(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="speaker-a-voice"
              className="block text-xs font-medium text-slate-700"
            >
              Голосовой профиль
            </label>
            <select
              id="speaker-a-voice"
              value={speakerAVoice}
              onChange={(e) => setSpeakerAVoice(e.target.value as VoiceName)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            >
              {VOICE_PROFILES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} — {v.timbre}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="speaker-a-style"
              className="block text-xs font-medium text-slate-700"
            >
              Характер речи
            </label>
            <input
              id="speaker-a-style"
              type="text"
              value={speakerAStyle}
              onChange={(e) => setSpeakerAStyle(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>
        </div>

        {/* Speaker B */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3.5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Диктор 2</h2>
            <span className="text-xs font-mono text-slate-500">Слот B</span>
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="speaker-b-name"
              className="block text-xs font-medium text-slate-700"
            >
              Имя в сценарии
            </label>
            <input
              id="speaker-b-name"
              type="text"
              value={speakerBName}
              onChange={(e) => setSpeakerBName(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="speaker-b-voice"
              className="block text-xs font-medium text-slate-700"
            >
              Голосовой профиль
            </label>
            <select
              id="speaker-b-voice"
              value={speakerBVoice}
              onChange={(e) => setSpeakerBVoice(e.target.value as VoiceName)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            >
              {VOICE_PROFILES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} — {v.timbre}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="speaker-b-style"
              className="block text-xs font-medium text-slate-700"
            >
              Характер речи
            </label>
            <input
              id="speaker-b-style"
              type="text"
              value={speakerBStyle}
              onChange={(e) => setSpeakerBStyle(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>
        </div>
      </aside>

      {/* Script Editor */}
      <section className="lg:col-span-8 space-y-5">
        <form
          onSubmit={handleSynthesizeDialogue}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Сценарий диалога
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Поддерживаются живые вставки{" "}
                <span className="font-mono text-slate-700">&lt;breath&gt;</span>,{" "}
                <span className="font-mono text-slate-700">&lt;laugh&gt;</span>,{" "}
                <span className="font-mono text-slate-700">|yeah|</span>,{" "}
                <span className="font-mono text-slate-700">|mhm|</span>
              </p>
            </div>
            <span className="text-xs font-mono text-slate-500">
              gemini-3.8-flash-tts
            </span>
          </div>

          <div className="space-y-3">
            {lines.map((line, index) => {
              const isA = line.speakerSlot === "A";
              return (
                <div
                  key={line.id}
                  className="flex items-start gap-3 pb-3 border-b border-slate-100 last:border-b-0 last:pb-0"
                >
                  <div className="w-28 shrink-0 pt-1 space-y-1">
                    <span className="block text-xs font-mono tabular-nums text-slate-400">
                      #{String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="grid grid-cols-2 gap-1 p-0.5 bg-slate-100 rounded-md">
                      <button
                        type="button"
                        onClick={() => updateLine(line.id, { speakerSlot: "A" })}
                        className={`py-1 text-xs font-medium rounded transition-colors truncate px-1 cursor-pointer ${
                          isA
                            ? "bg-white text-slate-900 shadow-sm"
                            : "text-slate-600 hover:text-slate-900"
                        }`}
                        title={speakerAName}
                      >
                        {speakerAName.slice(0, 6) || "A"}
                      </button>
                      <button
                        type="button"
                        onClick={() => updateLine(line.id, { speakerSlot: "B" })}
                        className={`py-1 text-xs font-medium rounded transition-colors truncate px-1 cursor-pointer ${
                          !isA
                            ? "bg-white text-slate-900 shadow-sm"
                            : "text-slate-600 hover:text-slate-900"
                        }`}
                        title={speakerBName}
                      >
                        {speakerBName.slice(0, 6) || "B"}
                      </button>
                    </div>
                  </div>

                  <textarea
                    rows={2}
                    value={line.text}
                    onChange={(e) =>
                      updateLine(line.id, { text: e.target.value })
                    }
                    placeholder={`Реплика для ${isA ? speakerAName : speakerBName}...`}
                    className="flex-1 min-w-0 rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                  />

                  <button
                    type="button"
                    onClick={() => removeLine(line.id)}
                    disabled={lines.length <= 1}
                    aria-label="Удалить реплику"
                    className="p-2 text-slate-400 hover:text-red-600 rounded-lg transition-colors disabled:opacity-30 cursor-pointer shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() =>
                addLine(
                  lines[lines.length - 1]?.speakerSlot === "A" ? "B" : "A"
                )
              }
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Добавить реплику
            </button>
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              {errorMsg}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
            <button
              type="submit"
              disabled={isGenerating}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-60 cursor-pointer"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Синтез диалога...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Озвучить диалог
                </>
              )}
            </button>

            <span className="text-xs text-slate-500">
              Единая дорожка 24 кГц WAV для двух голосов
            </span>
          </div>
        </form>

        {latestClip && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-900 truncate">
                  {latestClip.title}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {latestClip.voiceLabel} ·{" "}
                  <span className="font-mono tabular-nums">
                    {latestClip.durationSec.toFixed(1)} сек
                  </span>
                </p>
              </div>
              <a
                href={latestClip.audioUrl}
                download={`voxlive-dialogue-${Date.now()}.wav`}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-900 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-4 h-4" />
                Скачать WAV
              </a>
            </div>
            <audio
              controls
              src={latestClip.audioUrl}
              className="w-full h-10"
            />
          </div>
        )}
      </section>
    </div>
  );
}
