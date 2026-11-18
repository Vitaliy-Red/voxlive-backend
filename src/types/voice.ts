export type VoiceName = "Zephyr" | "Puck" | "Charon" | "Kore" | "Fenrir";

export interface VoiceProfile {
  id: VoiceName;
  label: string;
  timbre: string;
  bestFor: string;
}

export const VOICE_PROFILES: VoiceProfile[] = [
  {
    id: "Zephyr",
    label: "Zephyr",
    timbre: "Тёплый и сбалансированный",
    bestFor: "Живые диалоги, презентации, сторителлинг",
  },
  {
    id: "Kore",
    label: "Kore",
    timbre: "Ясный и собранный",
    bestFor: "Новости, дикторский текст, инструкции",
  },
  {
    id: "Puck",
    label: "Puck",
    timbre: "Энергичный и живой",
    bestFor: "Подкасты, динамичные реплики, интервью",
  },
  {
    id: "Charon",
    label: "Charon",
    timbre: "Глубокий и уверенный",
    bestFor: "Документалистика, аудиокниги, аналитика",
  },
  {
    id: "Fenrir",
    label: "Fenrir",
    timbre: "Насыщенный и фактурный",
    bestFor: "Драматические сцены, персонажи, трейлеры",
  },
];

export type AppSection = "live" | "tts" | "dialogue" | "library";

export type LiveConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "error";

export interface TranscriptEntry {
  id: string;
  role: "user" | "model" | "system";
  text: string;
  timestamp: string;
  isFinal?: boolean;
}

export interface SynthesizedClip {
  id: string;
  title: string;
  mode: "live" | "tts" | "dialogue";
  voiceLabel: string;
  model: string;
  stylePrompt?: string;
  textPreview: string;
  audioUrl: string;
  durationSec: number;
  createdAt: string;
}

export interface DialogueLine {
  id: string;
  speakerSlot: "A" | "B";
  text: string;
}
