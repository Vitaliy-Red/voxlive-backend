import { useCallback, useRef, useState } from "react";
import { Radio, Square } from "lucide-react";
import { ClipLibrary } from "./components/ClipLibrary";
import { DialogueStudio } from "./components/DialogueStudio";
import { LiveStudio } from "./components/LiveStudio";
import { TtsStudio } from "./components/TtsStudio";
import {
  AppSection,
  LiveConnectionState,
  SynthesizedClip,
} from "./types/voice";

const NAV_ITEMS: { id: AppSection; label: string }[] = [
  { id: "live", label: "Живой эфир" },
  { id: "tts", label: "Синтез текста" },
  { id: "dialogue", label: "Два диктора" },
  { id: "library", label: "Записи" },
];

const SECTION_DESCRIPTIONS: Record<
  AppSection,
  { title: string; subtitle: string }
> = {
  live: {
    title: "Голосовая студия Gemini Live",
    subtitle:
      "Двусторонний аудиопоток в реальном времени с выбором тембра, расшифровкой речи и сохранением синтезированных ответов в WAV.",
  },
  tts: {
    title: "Синтез речи и дизайн голоса",
    subtitle:
      "Потоковое и студийное озвучивание текста с управлением интонацией, паузами и живыми вокальными реакциями.",
  },
  dialogue: {
    title: "Сценарий для двух дикторов",
    subtitle:
      "Генерация естественного диалога или подкаста с разными голосами, характером подачи и бэкченнелингом.",
  },
  library: {
    title: "Библиотека синтезированных записей",
    subtitle:
      "Прослушивайте и скачивайте созданные аудиодорожки в формате 24 кГц PCM WAV.",
  },
};

export default function App() {
  const [activeSection, setActiveSection] = useState<AppSection>("live");
  const [liveState, setLiveState] = useState<LiveConnectionState>("idle");
  const [clips, setClips] = useState<SynthesizedClip[]>([]);

  const liveControlsRef = useRef<{
    start: () => void;
    stop: () => void;
  } | null>(null);

  const registerControls = useCallback(
    (controls: { start: () => void; stop: () => void }) => {
      liveControlsRef.current = controls;
    },
    []
  );

  const handleSaveClip = useCallback((clip: SynthesizedClip) => {
    setClips((prev) => [clip, ...prev]);
  }, []);

  const handleDeleteClip = useCallback((id: string) => {
    setClips((prev) => {
      const target = prev.find((c) => c.id === id);
      if (target) {
        URL.revokeObjectURL(target.audioUrl);
      }
      return prev.filter((c) => c.id !== id);
    });
  }, []);

  const handleHeaderAction = () => {
    if (liveState === "connected" || liveState === "connecting") {
      liveControlsRef.current?.stop();
    } else {
      setActiveSection("live");
      window.requestAnimationFrame(() => {
        liveControlsRef.current?.start();
      });
    }
  };

  const isLiveRunning =
    liveState === "connected" || liveState === "connecting";
  const headerInfo = SECTION_DESCRIPTIONS[activeSection];

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Bar Contract: Brand wordmark — 4 single-line nav links — 1 primary CTA */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-slate-200">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="#live"
            onClick={(e) => {
              e.preventDefault();
              setActiveSection("live");
            }}
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            VoxLive Studio
          </a>

          <nav
            aria-label="Основные разделы"
            className="hidden md:flex items-center gap-6 text-sm font-medium"
          >
            {NAV_ITEMS.map((item) => {
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveSection(item.id)}
                  className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
                    isActive
                      ? "text-slate-900 border-blue-600"
                      : "text-slate-600 border-transparent hover:text-slate-900 hover:border-slate-300"
                  }`}
                >
                  {item.label}
                  {item.id === "library" && clips.length > 0
                    ? ` (${clips.length})`
                    : ""}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={handleHeaderAction}
              className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isLiveRunning
                  ? "bg-red-600 hover:bg-red-700 text-white"
                  : "bg-slate-900 hover:bg-slate-800 text-white"
              }`}
            >
              {isLiveRunning ? (
                <>
                  <Square className="w-3.5 h-3.5" />
                  Остановить эфир
                </>
              ) : (
                <>
                  <Radio className="w-3.5 h-3.5" />
                  Начать эфир
                </>
              )}
            </button>
          </div>
        </div>

        {/* Mobile navigation row */}
        <nav
          aria-label="Мобильная навигация"
          className="md:hidden border-t border-slate-100 px-4 py-2 flex items-center gap-4 overflow-x-auto text-xs font-medium"
        >
          {NAV_ITEMS.map((item) => {
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveSection(item.id)}
                className={`py-1 whitespace-nowrap shrink-0 border-b-2 ${
                  isActive
                    ? "text-slate-900 border-blue-600"
                    : "text-slate-600 border-transparent"
                }`}
              >
                {item.label}
                {item.id === "library" && clips.length > 0
                  ? ` (${clips.length})`
                  : ""}
              </button>
            );
          })}
        </nav>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-[1360px] w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div className="max-w-3xl space-y-1.5">
          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900 text-balance">
            {headerInfo.title}
          </h1>
          <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
            {headerInfo.subtitle}
          </p>
        </div>

        {/* Keep LiveStudio mounted so an active WebSocket session persists across tabs */}
        <div className={activeSection === "live" ? "block" : "hidden"}>
          <LiveStudio
            connectionState={liveState}
            onConnectionStateChange={setLiveState}
            onSaveClip={handleSaveClip}
            registerControls={registerControls}
          />
        </div>

        {activeSection === "tts" && (
          <TtsStudio onSaveClip={handleSaveClip} />
        )}

        {activeSection === "dialogue" && (
          <DialogueStudio onSaveClip={handleSaveClip} />
        )}

        {activeSection === "library" && (
          <ClipLibrary
            clips={clips}
            onDeleteClip={handleDeleteClip}
            onGoToSynthesis={() => setActiveSection("tts")}
          />
        )}
      </main>
    </div>
  );
}
