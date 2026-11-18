import { useRef, useState } from "react";
import { Download, Loader2, Play, Sparkles, Square } from "lucide-react";
import {
  SynthesizedClip,
  VOICE_PROFILES,
  VoiceName,
} from "../types/voice";
import {
  base64ToUint8,
  createWavBlobFromBase64,
  createWavBlobFromPcmChunks,
  getWavDurationSeconds,
  pcm16Base64ToFloat32,
} from "../utils/audio";
import { getApiUrl } from "../utils/api";

interface TtsStudioProps {
  onSaveClip: (clip: SynthesizedClip) => void;
}

const STYLE_PRESETS = [
  {
    label: "Диктор новостей",
    style: "Чёткий, спокойный и профессиональный голос студийного диктора",
  },
  {
    label: "Аудиокнига",
    style: "Тёплая, глубокая, неспешная интонация рассказчика с мягкими паузами",
  },
  {
    label: "Энергичный обзор",
    style: "Бодрая, выразительная подача ведущего технологического шоу",
  },
  {
    label: "Камерный шёпот",
    style: "Тихий, доверительный голос вблизи микрофона, мягкий темп",
  },
];

const VOCAL_TAGS = [
  { tag: "<breath>", label: "Вдох" },
  { tag: "<laugh>", label: "Смех" },
  { tag: "<gasp>", label: "Удивление" },
  { tag: "|mhm|", label: "Поддакивание" },
  { tag: "|yeah|", label: "Согласие" },
];

export function TtsStudio({ onSaveClip }: TtsStudioProps) {
  const [voiceName, setVoiceName] = useState<VoiceName>("Kore");
  const [model, setModel] = useState<
    "gemini-3.8-flash-lite-tts" | "gemini-3.8-flash-tts"
  >("gemini-3.8-flash-tts");
  const [deliveryMode, setDeliveryMode] = useState<"stream" | "wav">("stream");
  const [stylePrompt, setStylePrompt] = useState(STYLE_PRESETS[0].style);
  const [text, setText] = useState(
    "Добро пожаловать в студию синтеза речи. <breath> Здесь можно настраивать тембр, интонацию и живые паузы в реальном времени."
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [isStreamingPlayback, setIsStreamingPlayback] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [latestClip, setLatestClip] = useState<SynthesizedClip | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const streamAudioCtxRef = useRef<AudioContext | null>(null);
  const streamSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const abortControllerRef = useRef<AbortController | null>(null);

  const insertVocalTag = (tag: string) => {
    const el = textareaRef.current;
    if (!el) {
      setText((prev) => `${prev} ${tag}`.trim());
      return;
    }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const before = text.slice(0, start);
    const after = text.slice(end);
    const spacerBefore = before.length > 0 && !before.endsWith(" ") ? " " : "";
    const spacerAfter = after.length > 0 && !after.startsWith(" ") ? " " : "";
    const next = `${before}${spacerBefore}${tag}${spacerAfter}${after}`;
    setText(next);
    setModel("gemini-3.8-flash-tts");
    window.requestAnimationFrame(() => {
      el.focus();
      const cursor =
        start + spacerBefore.length + tag.length + spacerAfter.length;
      el.setSelectionRange(cursor, cursor);
    });
  };

  const stopStreamingPlayback = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    for (const s of streamSourcesRef.current) {
      try {
        s.stop();
      } catch {
        // ignore
      }
    }
    streamSourcesRef.current.clear();
    if (streamAudioCtxRef.current) {
      streamAudioCtxRef.current.close().catch(() => {});
      streamAudioCtxRef.current = null;
    }
    setIsStreamingPlayback(false);
    setIsGenerating(false);
  };

  const handleSynthesize = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanText = text.trim();
    if (!cleanText) {
      setErrorMsg("Введите текст для синтеза речи.");
      return;
    }

    setErrorMsg(null);
    setIsGenerating(true);

    if (deliveryMode === "wav") {
      try {
        const res = await fetch(getApiUrl("/api/tts"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "single",
            text: cleanText,
            voiceName,
            style: stylePrompt,
            model,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Ошибка синтеза речи.");
        }

        const blob = createWavBlobFromBase64(data.audioBase64);
        const url = URL.createObjectURL(blob);
        const durationSec = await getWavDurationSeconds(blob);

        const clip: SynthesizedClip = {
          id: `tts-${Date.now()}`,
          title: `Синтез · ${voiceName}`,
          mode: "tts",
          voiceLabel: voiceName,
          model: data.model || model,
          stylePrompt: stylePrompt.trim(),
          textPreview: cleanText,
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
          err instanceof Error ? err.message : "Не удалось выполнить синтез."
        );
      } finally {
        setIsGenerating(false);
      }
      return;
    }

    // Streaming SSE PCM mode
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      streamAudioCtxRef.current = outputCtx;
      let nextStartTime = outputCtx.currentTime + 0.04;
      const pcmChunks: Uint8Array[] = [];
      let usedModel = model;

      setIsStreamingPlayback(true);

      const res = await fetch(getApiUrl("/api/tts/stream"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: cleanText,
          voiceName,
          style: stylePrompt,
          model,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error("Не удалось запустить потоковый синтез речи.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const block of lines) {
          const dataLine = block
            .split("\n")
            .find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          const payload = JSON.parse(dataLine.slice(6));

          if (payload.error) {
            throw new Error(payload.error);
          }

          if (payload.model) {
            usedModel = payload.model;
          }

          if (payload.pcm) {
            const rawBytes = base64ToUint8(payload.pcm);
            pcmChunks.push(rawBytes);

            const float32 = pcm16Base64ToFloat32(payload.pcm);
            if (float32.length > 0 && outputCtx.state !== "closed") {
              const audioBuffer = outputCtx.createBuffer(
                1,
                float32.length,
                24000
              );
              audioBuffer.getChannelData(0).set(float32);
              const src = outputCtx.createBufferSource();
              src.buffer = audioBuffer;
              src.connect(outputCtx.destination);

              const startAt = Math.max(
                outputCtx.currentTime + 0.015,
                nextStartTime
              );
              nextStartTime = startAt + audioBuffer.duration;
              streamSourcesRef.current.add(src);
              src.onended = () => {
                streamSourcesRef.current.delete(src);
                if (streamSourcesRef.current.size === 0) {
                  setIsStreamingPlayback(false);
                }
              };
              src.start(startAt);
            }
          }
        }
      }

      if (pcmChunks.length > 0) {
        const wavBlob = createWavBlobFromPcmChunks(pcmChunks, 24000, 1);
        const url = URL.createObjectURL(wavBlob);
        const durationSec = await getWavDurationSeconds(wavBlob);
        const clip: SynthesizedClip = {
          id: `tts-stream-${Date.now()}`,
          title: `Потоковый синтез · ${voiceName}`,
          mode: "tts",
          voiceLabel: voiceName,
          model: usedModel,
          stylePrompt: stylePrompt.trim(),
          textPreview: cleanText,
          audioUrl: url,
          durationSec,
          createdAt: new Date().toLocaleTimeString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        };
        setLatestClip(clip);
        onSaveClip(clip);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setErrorMsg(
          err instanceof Error
            ? err.message
            : "Ошибка потокового синтеза речи."
        );
      }
    } finally {
      setIsGenerating(false);
      if (streamSourcesRef.current.size === 0) {
        setIsStreamingPlayback(false);
      }
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left Sidebar: Voice & Style Controls */}
      <aside className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-6">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Настройки синтеза голоса
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Точная генерация дикторской речи, интонаций и дыхания.
          </p>
        </div>

        {/* Voice List */}
        <div className="space-y-2">
          <label className="block text-xs font-medium text-slate-700">
            Тембр диктора
          </label>
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
            {VOICE_PROFILES.map((voice) => {
              const selected = voiceName === voice.id;
              return (
                <button
                  key={voice.id}
                  type="button"
                  onClick={() => setVoiceName(voice.id)}
                  className={`w-full text-left px-3.5 py-2.5 transition-colors flex items-center justify-between gap-3 cursor-pointer ${
                    selected
                      ? "bg-blue-50/70 text-slate-900"
                      : "bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">
                        {voice.label}
                      </span>
                      <span className="text-xs text-slate-500 truncate">
                        · {voice.timbre}
                      </span>
                    </div>
                  </div>
                  <span
                    className={`w-3.5 h-3.5 rounded-full border shrink-0 flex items-center justify-center ${
                      selected
                        ? "border-blue-600 bg-blue-600"
                        : "border-slate-300 bg-white"
                    }`}
                  >
                    {selected && (
                      <span className="w-1.5 h-1.5 rounded-full bg-white" />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* TTS Model */}
        <div className="space-y-2">
          <label className="block text-xs font-medium text-slate-700">
            Модель синтеза
          </label>
          <div className="grid grid-cols-1 gap-2">
            <button
              type="button"
              onClick={() => setModel("gemini-3.8-flash-tts")}
              className={`text-left px-3.5 py-2.5 rounded-lg border transition-colors cursor-pointer ${
                model === "gemini-3.8-flash-tts"
                  ? "border-blue-600 bg-blue-50/60"
                  : "border-slate-200 bg-white hover:bg-slate-50"
              }`}
            >
              <div className="text-sm font-medium text-slate-900">
                Дизайн голоса и эмоции
              </div>
              <div className="text-xs text-slate-500 font-mono mt-0.5">
                gemini-3.8-flash-tts
              </div>
            </button>
            <button
              type="button"
              onClick={() => setModel("gemini-3.8-flash-lite-tts")}
              className={`text-left px-3.5 py-2.5 rounded-lg border transition-colors cursor-pointer ${
                model === "gemini-3.8-flash-lite-tts"
                  ? "border-blue-600 bg-blue-50/60"
                  : "border-slate-200 bg-white hover:bg-slate-50"
              }`}
            >
              <div className="text-sm font-medium text-slate-900">
                Быстрое чтение текста
              </div>
              <div className="text-xs text-slate-500 font-mono mt-0.5">
                gemini-3.8-flash-lite-tts
              </div>
            </button>
          </div>
        </div>

        {/* Delivery mode */}
        <div className="space-y-2">
          <label className="block text-xs font-medium text-slate-700">
            Режим воспроизведения
          </label>
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setDeliveryMode("stream")}
              className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                deliveryMode === "stream"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Потоковый PCM
            </button>
            <button
              type="button"
              onClick={() => setDeliveryMode("wav")}
              className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                deliveryMode === "wav"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Готовый WAV
            </button>
          </div>
        </div>
      </aside>

      {/* Main Editor Stage */}
      <section className="lg:col-span-8 space-y-5">
        <form
          onSubmit={handleSynthesize}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-5"
        >
          {/* Style Prompt */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label
                htmlFor="tts-style"
                className="text-sm font-semibold text-slate-900"
              >
                Характер и стиль звучания
              </label>
              <div className="flex flex-wrap gap-1.5">
                {STYLE_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setStylePrompt(preset.style)}
                    className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
            <input
              id="tts-style"
              type="text"
              value={stylePrompt}
              onChange={(e) => setStylePrompt(e.target.value)}
              placeholder="Например: спокойный баритон документального фильма, лёгкая улыбка в голосе..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>

          {/* Script Textarea + Vocal Tags */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label
                htmlFor="tts-text"
                className="text-sm font-semibold text-slate-900"
              >
                Текст для озвучивания
              </label>
              <div className="flex flex-wrap items-center gap-1.5">
                {VOCAL_TAGS.map((item) => (
                  <button
                    key={item.tag}
                    type="button"
                    onClick={() => insertVocalTag(item.tag)}
                    title={`Вставить ${item.tag}`}
                    className="px-2 py-1 text-xs font-mono text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              ref={textareaRef}
              id="tts-text"
              rows={7}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Введите текст на любом языке. Для живых пауз и эмоций используйте теги вроде <breath> или <laugh>..."
              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>
                24 кГц · 16-bit PCM · Mono WAV
              </span>
              <span className="font-mono tabular-nums">
                {text.length} симв.
              </span>
            </div>
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              {errorMsg}
            </div>
          )}

          {/* Action Row */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            {isStreamingPlayback ? (
              <button
                type="button"
                onClick={stopStreamingPlayback}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Square className="w-4 h-4" />
                Остановить поток
              </button>
            ) : (
              <button
                type="submit"
                disabled={isGenerating}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-60 cursor-pointer"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Синтез речи...
                  </>
                ) : (
                  <>
                    {deliveryMode === "stream" ? (
                      <Play className="w-4 h-4" />
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                    Синтезировать голос
                  </>
                )}
              </button>
            )}

            <span className="text-xs text-slate-500">
              Результат автоматически сохраняется в разделе «Записи»
            </span>
          </div>
        </form>

        {/* Latest Output Player */}
        {latestClip && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-900 truncate">
                  {latestClip.title}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {latestClip.model} ·{" "}
                  <span className="font-mono tabular-nums">
                    {latestClip.durationSec.toFixed(1)} сек
                  </span>
                </p>
              </div>
              <a
                href={latestClip.audioUrl}
                download={`voxlive-${latestClip.voiceLabel.toLowerCase()}-${Date.now()}.wav`}
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
