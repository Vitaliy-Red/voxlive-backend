import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  Mic,
  MicOff,
  Radio,
  Send,
  Square,
  Volume2,
} from "lucide-react";
import {
  LiveConnectionState,
  SynthesizedClip,
  TranscriptEntry,
  VOICE_PROFILES,
  VoiceName,
} from "../types/voice";
import {
  base64ToUint8,
  createWavBlobFromPcmChunks,
  float32ToInt16Base64,
  formatTimeSec,
  getWavDurationSeconds,
  pcm16Base64ToFloat32,
} from "../utils/audio";
import { getLiveWsUrl } from "../utils/api";
import { WaveformVisualizer } from "./WaveformVisualizer";

interface LiveStudioProps {
  connectionState: LiveConnectionState;
  onConnectionStateChange: (state: LiveConnectionState) => void;
  onSaveClip: (clip: SynthesizedClip) => void;
  registerControls: (controls: {
    start: () => void;
    stop: () => void;
  }) => void;
}

const PERSONA_PRESETS = [
  {
    label: "Диктор студии",
    prompt:
      "Ты — профессиональный диктор студии озвучивания. Когда пользователь присылает текст или просит что-то прочитать, озвучивай его с чистой дикцией, выразительной интонацией и естественными паузами. Если пользователь задаёт вопрос, отвечай кратко и по делу на русском языке.",
  },
  {
    label: "Ведущий подкаста",
    prompt:
      "Ты — харизматичный ведущий технологического подкаста. Говори живо, тепло и вовлечённо, поддерживай диалог естественными реакциями на русском языке.",
  },
  {
    label: "Голосовой актёр",
    prompt:
      "Ты — актёр дубляжа и аудиокниг. Меняй тембр, темп и эмоциональную подачу в зависимости от контекста сцены. Говори на русском языке.",
  },
  {
    label: "Синхронный помощник",
    prompt:
      "Ты — голосовой ИИ-помощник реального времени. Отвечай ясно, структурированно и максимально естественно в формате живой беседы на русском языке.",
  },
];

export function LiveStudio({
  connectionState,
  onConnectionStateChange,
  onSaveClip,
  registerControls,
}: LiveStudioProps) {
  const [voiceName, setVoiceName] = useState<VoiceName>("Zephyr");
  const [liveModel, setLiveModel] = useState<
    "gemini-3.8-live" | "gemini-3.8-live-extended-thinking"
  >("gemini-3.8-live");
  const [thinkingLevel, setThinkingLevel] = useState<"LOW" | "MEDIUM" | "HIGH">(
    "LOW"
  );
  const [systemInstruction, setSystemInstruction] = useState<string>(
    PERSONA_PRESETS[0].prompt
  );
  const [isMuted, setIsMuted] = useState(false);
  const [micAvailable, setMicAvailable] = useState(true);
  const [isModelSpeaking, setIsModelSpeaking] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [textInput, setTextInput] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hasRecordedAudio, setHasRecordedAudio] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [activeAnalyser, setActiveAnalyser] = useState<AnalyserNode | null>(
    null
  );

  // Refs for callbacks and real-time audio scheduling
  const wsRef = useRef<WebSocket | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const recordedPcmChunksRef = useRef<Uint8Array[]>([]);
  const isMutedRef = useRef(isMuted);
  const speakingTimeoutRef = useRef<number | null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
  const hasErrorRef = useRef(false);

  // Keep refs synced
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  // Switch displayed analyser based on who is speaking
  useEffect(() => {
    if (connectionState !== "connected") {
      setActiveAnalyser(null);
      return;
    }
    if (isModelSpeaking && outputAnalyserRef.current) {
      setActiveAnalyser(outputAnalyserRef.current);
    } else if (inputAnalyserRef.current) {
      setActiveAnalyser(inputAnalyserRef.current);
    } else if (outputAnalyserRef.current) {
      setActiveAnalyser(outputAnalyserRef.current);
    }
  }, [connectionState, isModelSpeaking]);

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptScrollRef.current) {
      transcriptScrollRef.current.scrollTop =
        transcriptScrollRef.current.scrollHeight;
    }
  }, [transcripts]);

  // Session timer
  useEffect(() => {
    if (connectionState !== "connected") {
      return;
    }
    const timer = window.setInterval(() => {
      setElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [connectionState]);

  const stopPlaybackQueue = useCallback(() => {
    for (const src of activeSourcesRef.current) {
      try {
        src.stop();
      } catch {
        // already stopped
      }
    }
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setIsModelSpeaking(false);
  }, []);

  const cleanupAudioAndSocket = useCallback(() => {
    stopPlaybackQueue();

    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {
        // ignore
      }
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    if (inputAudioCtxRef.current) {
      inputAudioCtxRef.current.close().catch(() => {});
      inputAudioCtxRef.current = null;
    }

    if (outputAudioCtxRef.current) {
      outputAudioCtxRef.current.close().catch(() => {});
      outputAudioCtxRef.current = null;
    }

    inputAnalyserRef.current = null;
    outputAnalyserRef.current = null;

    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "stop" }));
        }
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }

    if (speakingTimeoutRef.current) {
      window.clearTimeout(speakingTimeoutRef.current);
      speakingTimeoutRef.current = null;
    }
  }, [stopPlaybackQueue]);

  const schedulePcm24kPlayback = useCallback((base64Pcm: string) => {
    const ctx = outputAudioCtxRef.current;
    const analyser = outputAnalyserRef.current;
    if (!ctx || !analyser) return;

    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    const rawBytes = base64ToUint8(base64Pcm);
    recordedPcmChunksRef.current.push(rawBytes);
    setHasRecordedAudio(true);

    const float32 = pcm16Base64ToFloat32(base64Pcm);
    if (float32.length === 0) return;

    const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
    audioBuffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(analyser);

    const now = ctx.currentTime;
    const startAt = Math.max(now + 0.015, nextStartTimeRef.current);
    nextStartTimeRef.current = startAt + audioBuffer.duration;

    activeSourcesRef.current.add(source);
    setIsModelSpeaking(true);

    if (speakingTimeoutRef.current) {
      window.clearTimeout(speakingTimeoutRef.current);
    }

    source.onended = () => {
      activeSourcesRef.current.delete(source);
      if (activeSourcesRef.current.size === 0) {
        speakingTimeoutRef.current = window.setTimeout(() => {
          setIsModelSpeaking(false);
        }, 180);
      }
    };

    source.start(startAt);
  }, []);

  const appendTranscript = useCallback(
    (role: "user" | "model" | "system", chunkText: string) => {
      const cleaned = chunkText;
      if (!cleaned) return;
      const nowLabel = new Date().toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      setTranscripts((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === role && !last.isFinal && role !== "system") {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...last,
            text: last.text + cleaned,
          };
          return updated;
        }
        return [
          ...prev,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            role,
            text: cleaned,
            timestamp: nowLabel,
            isFinal: role === "system",
          },
        ];
      });
    },
    []
  );

  const finalizeTurns = useCallback(() => {
    setTranscripts((prev) =>
      prev.map((item) => (item.isFinal ? item : { ...item, isFinal: true }))
    );
  }, []);

  const saveCurrentRecording = useCallback(async () => {
    if (recordedPcmChunksRef.current.length === 0) return;
    const blob = createWavBlobFromPcmChunks(recordedPcmChunksRef.current, 24000, 1);
    const url = URL.createObjectURL(blob);
    const durationSec = await getWavDurationSeconds(blob);
    const modelTranscripts = transcripts
      .filter((t) => t.role === "model")
      .map((t) => t.text)
      .join(" ")
      .trim();

    onSaveClip({
      id: `live-${Date.now()}`,
      title: `Живой эфир · ${voiceName}`,
      mode: "live",
      voiceLabel: voiceName,
      model: liveModel,
      stylePrompt: systemInstruction.slice(0, 80),
      textPreview: modelTranscripts || "Запись синтеза речи из сессии Gemini Live",
      audioUrl: url,
      durationSec,
      createdAt: new Date().toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    });
  }, [liveModel, onSaveClip, systemInstruction, transcripts, voiceName]);

  const stopSession = useCallback(() => {
    cleanupAudioAndSocket();
    onConnectionStateChange("idle");
  }, [cleanupAudioAndSocket, onConnectionStateChange]);

  const startSession = useCallback(async () => {
    if (connectionState === "connecting" || connectionState === "connected") {
      return;
    }

    setErrorMsg(null);
    hasErrorRef.current = false;
    setElapsedSec(0);
    recordedPcmChunksRef.current = [];
    setHasRecordedAudio(false);
    setTranscripts([]);
    onConnectionStateChange("connecting");

    try {
      // 1. Setup 24kHz output context
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      const outputAnalyser = outputCtx.createAnalyser();
      outputAnalyser.fftSize = 256;
      outputAnalyser.connect(outputCtx.destination);
      outputAudioCtxRef.current = outputCtx;
      outputAnalyserRef.current = outputAnalyser;

      // 2. Try microphone capture (16kHz target)
      let micStream: MediaStream | null = null;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        setMicAvailable(true);
      } catch {
        setMicAvailable(false);
        setIsMuted(true);
        appendTranscript(
          "system",
          "Микрофон недоступен или доступ отклонён — сессия работает в режиме текстового ввода с голосовым ответом Gemini Live."
        );
      }

      if (micStream) {
        const inputCtx = new AudioContext({ sampleRate: 16000 });
        const source = inputCtx.createMediaStreamSource(micStream);
        const inputAnalyser = inputCtx.createAnalyser();
        inputAnalyser.fftSize = 256;

        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        source.connect(inputAnalyser);
        inputAnalyser.connect(processor);
        // Connect processor to a muted GainNode so onaudioprocess fires without mic echo
        const silentGain = inputCtx.createGain();
        silentGain.gain.value = 0;
        processor.connect(silentGain);
        silentGain.connect(inputCtx.destination);

        inputAudioCtxRef.current = inputCtx;
        inputAnalyserRef.current = inputAnalyser;
        streamRef.current = micStream;
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
          if (isMutedRef.current) return;
          const ws = wsRef.current;
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          const channelData = e.inputBuffer.getChannelData(0);
          const base64Pcm = float32ToInt16Base64(
            channelData,
            inputCtx.sampleRate,
            16000
          );
          ws.send(JSON.stringify({ type: "audio", data: base64Pcm }));
        };
      }

      // 3. Connect WebSocket to server proxy
      const ws = new WebSocket(getLiveWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "start",
            voiceName,
            model: liveModel,
            thinkingLevel,
            systemInstruction,
          })
        );
      };

      ws.onmessage = (event) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        if (msg.type === "ready") {
          onConnectionStateChange("connected");
          return;
        }

        if (msg.type === "audio" && typeof msg.data === "string") {
          schedulePcm24kPlayback(msg.data);
          return;
        }

        if (msg.type === "inputTranscript" && typeof msg.text === "string") {
          appendTranscript("user", msg.text);
          return;
        }

        if (msg.type === "outputTranscript" && typeof msg.text === "string") {
          appendTranscript("model", msg.text);
          return;
        }

        if (msg.type === "interrupted") {
          stopPlaybackQueue();
          finalizeTurns();
          return;
        }

        if (msg.type === "turnComplete") {
          finalizeTurns();
          return;
        }

        if (msg.type === "error") {
          const message =
            typeof msg.message === "string"
              ? msg.message
              : "Ошибка соединения с Gemini Live.";
          hasErrorRef.current = true;
          setErrorMsg(message);
          cleanupAudioAndSocket();
          onConnectionStateChange("error");
          return;
        }

        if (msg.type === "closed") {
          cleanupAudioAndSocket();
          if (!hasErrorRef.current) {
            onConnectionStateChange("idle");
          }
        }
      };

      ws.onerror = () => {
        hasErrorRef.current = true;
        setErrorMsg("Не удалось установить WebSocket-соединение с сервером.");
        cleanupAudioAndSocket();
        onConnectionStateChange("error");
      };

      ws.onclose = () => {
        cleanupAudioAndSocket();
        if (!hasErrorRef.current) {
          onConnectionStateChange("idle");
        }
      };
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Не удалось запустить сессию.";
      setErrorMsg(msg);
      cleanupAudioAndSocket();
      onConnectionStateChange("error");
    }
  }, [
    appendTranscript,
    cleanupAudioAndSocket,
    connectionState,
    finalizeTurns,
    liveModel,
    onConnectionStateChange,
    schedulePcm24kPlayback,
    stopPlaybackQueue,
    systemInstruction,
    thinkingLevel,
    voiceName,
  ]);

  useEffect(() => {
    registerControls({ start: startSession, stop: stopSession });
  }, [registerControls, startSession, stopSession]);

  useEffect(() => {
    return () => {
      cleanupAudioAndSocket();
    };
  }, [cleanupAudioAndSocket]);

  const handleSendTextToLive = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = textInput.trim();
    if (!trimmed) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setErrorMsg("Сначала запустите сессию Gemini Live.");
      return;
    }

    wsRef.current.send(JSON.stringify({ type: "text", text: trimmed }));
    appendTranscript("user", trimmed);
    finalizeTurns();
    setTextInput("");
  };

  const handleDownloadWav = () => {
    if (recordedPcmChunksRef.current.length === 0) return;
    const blob = createWavBlobFromPcmChunks(
      recordedPcmChunksRef.current,
      24000,
      1
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gemini-live-${voiceName.toLowerCase()}-${Date.now()}.wav`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isRunning =
    connectionState === "connected" || connectionState === "connecting";

  const statusText =
    connectionState === "connected"
      ? isModelSpeaking
        ? "Синтез ответа"
        : "Эфир активен"
      : connectionState === "connecting"
        ? "Подключение"
        : connectionState === "error"
          ? "Ошибка сессии"
          : "Готово к запуску";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left Sidebar: Voice & Persona Configuration */}
      <aside className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-6">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Параметры голоса Live
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Выберите тембр и модель перед запуском реального эфира.
          </p>
        </div>

        {/* Voice Selection */}
        <div className="space-y-2">
          <label className="block text-xs font-medium text-slate-700">
            Голосовой профиль
          </label>
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
            {VOICE_PROFILES.map((voice) => {
              const selected = voiceName === voice.id;
              return (
                <button
                  key={voice.id}
                  type="button"
                  disabled={isRunning}
                  onClick={() => setVoiceName(voice.id)}
                  className={`w-full text-left px-3.5 py-2.5 transition-colors flex items-center justify-between gap-3 ${
                    selected
                      ? "bg-blue-50/70 text-slate-900"
                      : "bg-white text-slate-700 hover:bg-slate-50"
                  } ${isRunning ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
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
                    <p className="text-xs text-slate-500 truncate mt-0.5">
                      {voice.bestFor}
                    </p>
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

        {/* Model Selection */}
        <div className="space-y-2">
          <label className="block text-xs font-medium text-slate-700">
            Модель Gemini Live
          </label>
          <div className="grid grid-cols-1 gap-2">
            <button
              type="button"
              disabled={isRunning}
              onClick={() => setLiveModel("gemini-3.8-live")}
              className={`text-left px-3.5 py-2.5 rounded-lg border transition-colors ${
                liveModel === "gemini-3.8-live"
                  ? "border-blue-600 bg-blue-50/60"
                  : "border-slate-200 bg-white hover:bg-slate-50"
              } ${isRunning ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <div className="text-sm font-medium text-slate-900">
                Потоковый диалог
              </div>
              <div className="text-xs text-slate-500 font-mono mt-0.5">
                gemini-3.8-live · минимальная задержка
              </div>
            </button>
            <button
              type="button"
              disabled={isRunning}
              onClick={() => setLiveModel("gemini-3.8-live-extended-thinking")}
              className={`text-left px-3.5 py-2.5 rounded-lg border transition-colors ${
                liveModel === "gemini-3.8-live-extended-thinking"
                  ? "border-blue-600 bg-blue-50/60"
                  : "border-slate-200 bg-white hover:bg-slate-50"
              } ${isRunning ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <div className="text-sm font-medium text-slate-900">
                Глубокое рассуждение
              </div>
              <div className="text-xs text-slate-500 font-mono mt-0.5">
                gemini-3.8-live-extended-thinking
              </div>
            </button>
          </div>

          {liveModel === "gemini-3.8-live-extended-thinking" && (
            <div className="pt-1">
              <label className="block text-xs text-slate-600 mb-1.5">
                Глубина рассуждения
              </label>
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
                {(["LOW", "MEDIUM", "HIGH"] as const).map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    disabled={isRunning}
                    onClick={() => setThinkingLevel(lvl)}
                    className={`py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      thinkingLevel === lvl
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* System Instruction */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="live-instruction"
              className="block text-xs font-medium text-slate-700"
            >
              Роль и подача речи
            </label>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PERSONA_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                disabled={isRunning}
                onClick={() => setSystemInstruction(preset.prompt)}
                className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                {preset.label}
              </button>
            ))}
          </div>
          <textarea
            id="live-instruction"
            rows={4}
            disabled={isRunning}
            value={systemInstruction}
            onChange={(e) => setSystemInstruction(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 disabled:bg-slate-50 disabled:text-slate-500"
            placeholder="Опишите характер голоса, стиль чтения или роль..."
          />
        </div>
      </aside>

      {/* Main Stage: Live Acoustic Stage & Transcript */}
      <section className="lg:col-span-8 space-y-5">
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          {/* Stage Status Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-3 min-w-0">
              {connectionState === "connected" ? (
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 animate-pulse shrink-0" />
              ) : connectionState === "connecting" ? (
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
              ) : connectionState === "error" ? (
                <span className="w-2.5 h-2.5 rounded-full bg-red-600 shrink-0" />
              ) : (
                <span className="w-2.5 h-2.5 rounded-full bg-slate-300 shrink-0" />
              )}
              <span className="text-sm font-semibold text-slate-900 whitespace-nowrap">
                {statusText}
              </span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span className="text-xs font-mono text-slate-500 truncate">
                {voiceName} · 16 кГц вход / 24 кГц PCM выход
              </span>
            </div>

            <div className="flex items-center gap-4 shrink-0">
              <span className="text-sm font-mono tabular-nums text-slate-700">
                {formatTimeSec(elapsedSec)}
              </span>
              {connectionState === "connected" ||
              connectionState === "connecting" ? (
                <button
                  type="button"
                  onClick={stopSession}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Square className="w-4 h-4" />
                  Остановить
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startSession}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Radio className="w-4 h-4" />
                  Запустить Live
                </button>
              )}
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

          {/* Acoustic Waveform */}
          <WaveformVisualizer
            analyser={activeAnalyser}
            isActive={connectionState === "connected"}
            isModelSpeaking={isModelSpeaking}
            isMuted={isMuted}
          />

          {/* Hardware / Capture Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                disabled={connectionState !== "connected" || !micAvailable}
                onClick={() => setIsMuted((m) => !m)}
                className={`inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  isMuted || !micAvailable
                    ? "border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200"
                    : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {isMuted || !micAvailable ? (
                  <>
                    <MicOff className="w-4 h-4 text-slate-500" />
                    Микрофон выкл
                  </>
                ) : (
                  <>
                    <Mic className="w-4 h-4 text-blue-600" />
                    Микрофон вкл
                  </>
                )}
              </button>

              {isModelSpeaking && (
                <button
                  type="button"
                  onClick={stopPlaybackQueue}
                  className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
                >
                  <Volume2 className="w-4 h-4 text-blue-600" />
                  Прервать озвучку
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!hasRecordedAudio}
                onClick={saveCurrentRecording}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed"
              >
                В библиотеку
              </button>
              <button
                type="button"
                disabled={!hasRecordedAudio}
                onClick={handleDownloadWav}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-900 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" />
                Скачать WAV
              </button>
            </div>
          </div>

          {/* Direct Text-to-Live-Voice Prompt */}
          <form onSubmit={handleSendTextToLive} className="flex gap-2 pt-1">
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              disabled={connectionState !== "connected"}
              placeholder={
                connectionState === "connected"
                  ? "Введите фразу, чтобы Gemini Live озвучил её или ответил голосом..."
                  : "Запустите сессию, чтобы отправлять текст в живой эфир..."
              }
              className="flex-1 min-w-0 rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={connectionState !== "connected" || !textInput.trim()}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
              Озвучить
            </button>
          </form>
        </div>

        {/* Live Transcript Log */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between gap-4 pb-3 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">
              Стенограмма живого эфира
            </h3>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {transcripts.length}{" "}
              {transcripts.length === 1 ? "реплика" : "реплик"}
            </span>
          </div>

          <div
            ref={transcriptScrollRef}
            className="mt-4 max-h-72 overflow-y-auto space-y-3 pr-1"
          >
            {transcripts.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-sm text-slate-600">
                  Здесь появится расшифровка вашей речи и голосовых ответов
                  Gemini Live в реальном времени.
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Нажмите «Запустить Live», говорите в микрофон или отправьте
                  текст для озвучивания.
                </p>
              </div>
            ) : (
              transcripts.map((entry) => (
                <div
                  key={entry.id}
                  className={`rounded-lg px-4 py-3 text-sm ${
                    entry.role === "user"
                      ? "bg-slate-50 border border-slate-200 text-slate-900"
                      : entry.role === "model"
                        ? "bg-blue-50/50 border border-blue-100 text-slate-900"
                        : "bg-amber-50/70 border border-amber-200 text-amber-900"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-semibold text-slate-700">
                      {entry.role === "user"
                        ? "Вы"
                        : entry.role === "model"
                          ? `Gemini Live · ${voiceName}`
                          : "Система"}
                    </span>
                    <span className="text-xs font-mono tabular-nums text-slate-400">
                      {entry.timestamp}
                    </span>
                  </div>
                  <p className="leading-relaxed whitespace-pre-wrap">
                    {entry.text}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
