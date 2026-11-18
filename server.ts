import "dotenv/config";
import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import {
  GoogleGenAI,
  LiveServerMessage,
  Modality,
  ThinkingLevel,
} from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

function createAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Отсутствует ключ GEMINI_API_KEY. Проверьте панель Settings > Secrets."
    );
  }
  return new GoogleGenAI({
    apiKey,
    apiVersion: "v1beta",
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function formatGeminiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes("GEMINI_API_KEY")) {
    return { status: 500, message: raw };
  }
  if (
    raw.includes("PERMISSION_DENIED") ||
    raw.includes("UNAUTHENTICATED") ||
    raw.includes("401") ||
    raw.includes("403") ||
    raw.includes("API_KEY_INVALID") ||
    raw.includes("API key not valid") ||
    raw.includes("ACCESS_TOKEN_TYPE_UNSUPPORTED")
  ) {
    return {
      status: 403,
      message:
        "Ключ Gemini API не принят (401/403). Пожалуйста, проверьте или выберите ваш ключ в панели Settings > Secrets (и обновите страницу).",
    };
  }
  if (raw.includes("RESOURCE_EXHAUSTED") || raw.includes("429")) {
    return {
      status: 429,
      message:
        "Превышен лимит запросов к Gemini API (429). Повторите попытку чуть позже или проверьте квоту.",
    };
  }
  if (raw.includes("NOT_FOUND") || raw.includes("404")) {
    return {
      status: 404,
      message: `Запрошенная модель недоступна: ${raw}`,
    };
  }
  return { status: 500, message: raw || "Неизвестная ошибка сервера Gemini API" };
}

const VALID_VOICES = new Set(["Zephyr", "Puck", "Charon", "Kore", "Fenrir"]);

function sanitizeVoice(voice: unknown): string {
  return typeof voice === "string" && VALID_VOICES.has(voice) ? voice : "Zephyr";
}

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  const configured = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (configured.includes("*")) return true;
  if (configured.includes(origin)) return true;
  if (process.env.APP_URL && origin === process.env.APP_URL) return true;

  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== "https:" && protocol !== "http:") return false;
    if (
      hostname === "coach-ai.pages.dev" ||
      hostname.endsWith(".coach-ai.pages.dev") ||
      hostname === "localhost" ||
      hostname === "127.0.0.1"
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  // CORS for external frontend hosting (e.g. Cloudflare Pages coach-ai.pages.dev)
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && isOriginAllowed(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  const server = http.createServer(app);

  // Health endpoint
  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      ready: Boolean(process.env.GEMINI_API_KEY),
    });
  });

  // Unary TTS generation (returns complete WAV file as base64)
  app.post("/api/tts", async (req, res) => {
    try {
      const ai = createAiClient();
      const {
        mode = "single",
        text = "",
        voiceName = "Zephyr",
        style = "",
        model = "gemini-3.8-flash-lite-tts",
        speakerAName = "Ведущий",
        speakerAVoice = "Puck",
        speakerAStyle = "",
        speakerBName = "Эксперт",
        speakerBVoice = "Kore",
        speakerBStyle = "",
        dialogueLines = [],
      } = req.body ?? {};

      const selectedModel =
        model === "gemini-3.8-flash-tts"
          ? "gemini-3.8-flash-tts"
          : "gemini-3.8-flash-lite-tts";

      if (mode === "dialogue") {
        if (!Array.isArray(dialogueLines) || dialogueLines.length === 0) {
          return res.status(400).json({ error: "Добавьте хотя бы одну реплику диалога." });
        }

        const cleanSpeakerA = String(speakerAName || "Диктор 1").trim();
        const cleanSpeakerB = String(speakerBName || "Диктор 2").trim();

        const parts = dialogueLines
          .filter((line: { text?: string }) => line?.text && line.text.trim().length > 0)
          .map((line: { speakerSlot?: "A" | "B"; text: string }) => {
            const isA = line.speakerSlot !== "B";
            const speaker = isA ? cleanSpeakerA : cleanSpeakerB;
            const speakerStyle = isA
              ? String(speakerAStyle || "").trim()
              : String(speakerBStyle || "").trim();

            return {
              text: `${speaker}: ${line.text.trim()}`,
              speechMetadata: {
                speaker,
                ...(speakerStyle ? { style: speakerStyle } : {}),
              },
            };
          });

        if (parts.length === 0) {
          return res.status(400).json({ error: "Текст реплик не может быть пустым." });
        }

        const response = await ai.models.generateContent({
          model: "gemini-3.8-flash-tts",
          contents: [
            {
              role: "user",
              parts,
            },
          ],
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              multiSpeakerVoiceConfig: {
                speakerVoiceConfigs: [
                  {
                    speaker: cleanSpeakerA,
                    voiceConfig: {
                      prebuiltVoiceConfig: {
                        voiceName: sanitizeVoice(speakerAVoice),
                      },
                    },
                  },
                  {
                    speaker: cleanSpeakerB,
                    voiceConfig: {
                      prebuiltVoiceConfig: {
                        voiceName: sanitizeVoice(speakerBVoice),
                      },
                    },
                  },
                ],
              },
            },
          },
        });

        const base64Audio =
          response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!base64Audio) {
          return res.status(502).json({
            error: "Модель не вернула аудиодорожку. Попробуйте упростить текст или стиль.",
          });
        }

        return res.json({
          audioBase64: base64Audio,
          mimeType: "audio/wav",
          model: "gemini-3.8-flash-tts",
        });
      }

      // Single-speaker synthesis
      const cleanText = String(text || "").trim();
      if (!cleanText) {
        return res.status(400).json({ error: "Введите текст для синтеза речи." });
      }

      const cleanStyle = String(style || "").trim();
      const useExpressiveModel =
        selectedModel === "gemini-3.8-flash-tts" ||
        cleanText.includes("<") ||
        cleanText.includes("|");

      const effectiveModel = useExpressiveModel
        ? "gemini-3.8-flash-tts"
        : selectedModel;

      const part: { text: string; speechMetadata?: { style: string } } = {
        text: cleanText,
      };
      if (cleanStyle) {
        part.speechMetadata = { style: cleanStyle };
      }

      const response = await ai.models.generateContent({
        model: effectiveModel,
        contents: [
          {
            role: "user",
            parts: [part],
          },
        ],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: sanitizeVoice(voiceName),
              },
            },
          },
        },
      });

      const base64Audio =
        response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        return res.status(502).json({
          error: "Модель не вернула аудиодорожку. Попробуйте изменить текст.",
        });
      }

      return res.json({
        audioBase64: base64Audio,
        mimeType: "audio/wav",
        model: effectiveModel,
      });
    } catch (err) {
      const { status, message } = formatGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // Streaming TTS via SSE (raw 24kHz L16 PCM chunks)
  app.post("/api/tts/stream", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    try {
      const ai = createAiClient();
      const {
        text = "",
        voiceName = "Zephyr",
        style = "",
        model = "gemini-3.8-flash-lite-tts",
      } = req.body ?? {};

      const cleanText = String(text || "").trim();
      if (!cleanText) {
        res.write(`data: ${JSON.stringify({ error: "Введите текст для потокового синтеза." })}\n\n`);
        res.end();
        return;
      }

      const cleanStyle = String(style || "").trim();
      const effectiveModel =
        model === "gemini-3.8-flash-tts" || cleanText.includes("<") || cleanText.includes("|")
          ? "gemini-3.8-flash-tts"
          : "gemini-3.8-flash-lite-tts";

      const part: { text: string; speechMetadata?: { style: string } } = {
        text: cleanText,
      };
      if (cleanStyle) {
        part.speechMetadata = { style: cleanStyle };
      }

      const responseStream = await ai.models.generateContentStream({
        model: effectiveModel,
        contents: [{ role: "user", parts: [part] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: sanitizeVoice(voiceName),
              },
            },
          },
        },
      });

      for await (const chunk of responseStream) {
        const data = chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (data) {
          res.write(`data: ${JSON.stringify({ pcm: data })}\n\n`);
        }
      }

      res.write(`data: ${JSON.stringify({ done: true, model: effectiveModel })}\n\n`);
      res.end();
    } catch (err) {
      const { message } = formatGeminiError(err);
      res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
      res.end();
    }
  });

  // WebSocket Server for Gemini Live API (/api/live)
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const reqUrl = request.url || "";
    if (reqUrl.startsWith("/api/live")) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
  });

  wss.on("connection", (clientWs: WebSocket) => {
    let liveSession: Awaited<ReturnType<GoogleGenAI["live"]["connect"]>> | null = null;
    let isClosed = false;
    let isConnecting = false;

    const sendToClient = (payload: Record<string, unknown>) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    const closeSession = () => {
      if (liveSession) {
        try {
          liveSession.close();
        } catch {
          // ignore close errors
        }
        liveSession = null;
      }
    };

    clientWs.on("message", async (raw) => {
      if (isClosed) return;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (parsed.type === "start") {
        if (isConnecting || liveSession) return;
        isConnecting = true;

        try {
          const ai = createAiClient();
          const voiceName = sanitizeVoice(parsed.voiceName);
          const useExtendedThinking = parsed.model === "gemini-3.8-live-extended-thinking";
          const model = useExtendedThinking
            ? "gemini-3.8-live-extended-thinking"
            : "gemini-3.8-live";

          const systemInstruction =
            typeof parsed.systemInstruction === "string" &&
            parsed.systemInstruction.trim().length > 0
              ? parsed.systemInstruction.trim()
              : "Ты — профессиональный голосовой ассистент и диктор студии синтеза речи. Отвечай естественно, выразительно и лаконично на языке пользователя (по умолчанию на русском). Если пользователь просит озвучить текст, прочитай его с нужной интонацией без лишних комментариев.";

          const config: Record<string, unknown> = {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
            },
            systemInstruction,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          };

          if (useExtendedThinking) {
            const levelMap: Record<string, ThinkingLevel> = {
              LOW: ThinkingLevel.LOW,
              MEDIUM: ThinkingLevel.MEDIUM,
              HIGH: ThinkingLevel.HIGH,
            };
            const reqLevel =
              typeof parsed.thinkingLevel === "string"
                ? levelMap[parsed.thinkingLevel] ?? ThinkingLevel.LOW
                : ThinkingLevel.LOW;
            config.thinkingConfig = { thinkingLevel: reqLevel };
          }

          let readySent = false;
          let errorSent = false;

          liveSession = await ai.live.connect({
            model,
            config,
            callbacks: {
              onopen: () => {
                // Wait for setupComplete in onmessage before signaling ready
              },
              onmessage: (message: LiveServerMessage) => {
                if (message.setupComplete && !readySent) {
                  readySent = true;
                  sendToClient({ type: "ready", model, voiceName });
                }

                const content = message.serverContent;
                if (!content) return;

                if (!readySent) {
                  readySent = true;
                  sendToClient({ type: "ready", model, voiceName });
                }

                if (content.inputTranscription?.text) {
                  sendToClient({
                    type: "inputTranscript",
                    text: content.inputTranscription.text,
                  });
                }

                if (content.outputTranscription?.text) {
                  sendToClient({
                    type: "outputTranscript",
                    text: content.outputTranscription.text,
                  });
                }

                for (const part of content.modelTurn?.parts ?? []) {
                  if (part.inlineData?.data) {
                    sendToClient({
                      type: "audio",
                      data: part.inlineData.data,
                    });
                  }
                }

                if (content.interrupted) {
                  sendToClient({ type: "interrupted" });
                }

                if (content.turnComplete) {
                  sendToClient({ type: "turnComplete" });
                }

                if (content.interactionStatus) {
                  sendToClient({
                    type: "interactionStatus",
                    status: content.interactionStatus,
                  });
                }
              },
              onerror: (err: ErrorEvent) => {
                if (!errorSent) {
                  errorSent = true;
                  const { message } = formatGeminiError(
                    err.message || "Ошибка WebSocket-сессии Gemini Live."
                  );
                  sendToClient({ type: "error", message });
                }
              },
              onclose: (ev: CloseEvent) => {
                if (!errorSent && (ev.reason || (!readySent && ev.code !== 1000))) {
                  errorSent = true;
                  const { message } = formatGeminiError(
                    ev.reason || `Сессия закрыта сервером (код ${ev.code}).`
                  );
                  sendToClient({ type: "error", message });
                }
                sendToClient({ type: "closed" });
                liveSession = null;
              },
            },
          });
        } catch (err) {
          const { message } = formatGeminiError(err);
          sendToClient({ type: "error", message });
          closeSession();
        } finally {
          isConnecting = false;
        }
        return;
      }

      if (parsed.type === "audio" && typeof parsed.data === "string") {
        if (liveSession) {
          try {
            liveSession.sendRealtimeInput({
              audio: {
                data: parsed.data,
                mimeType: "audio/pcm;rate=16000",
              },
            });
          } catch (err) {
            const { message } = formatGeminiError(err);
            sendToClient({ type: "error", message });
          }
        }
        return;
      }

      if (parsed.type === "text" && typeof parsed.text === "string") {
        if (liveSession && parsed.text.trim()) {
          try {
            liveSession.sendRealtimeInput({
              text: parsed.text.trim(),
            });
          } catch (err) {
            const { message } = formatGeminiError(err);
            sendToClient({ type: "error", message });
          }
        }
        return;
      }

      if (parsed.type === "stop") {
        closeSession();
        sendToClient({ type: "closed" });
      }
    });

    clientWs.on("close", () => {
      isClosed = true;
      closeSession();
    });
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`VoxLive Studio server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
