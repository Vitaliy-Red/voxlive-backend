import type { Live, LiveConnectConfig, LiveServerMessage, Session } from "@google/genai";

type Options = {
  model: string;
  config: LiveConnectConfig;
  onmessage: (message: LiveServerMessage) => void;
  onstatus: (phase: "reconnecting" | "resumed", code?: number) => void;
  onclose: (code: number, reason: string) => void;
};

// A single browser call can span multiple Gemini WebSockets. The resumption
// handle stays on this connection and is discarded as soon as it is consumed.
export function openCoachSession(live: Pick<Live, "connect">, options: Options) {
  let peer: Session | null = null;
  let generation = 0;
  let ready = false;
  let closed = false;
  let ending = false;
  let handle: string | undefined;
  let timer: ReturnType<typeof setTimeout>;

  function detach() {
    generation++;
    ready = false;
    clearTimeout(timer);
    const old = peer;
    peer = null;
    try { old?.close(); } catch { /* already closed */ }
  }

  function finish(code: number, reason: string) {
    if (closed) return;
    const checkpoint = handle;
    handle = undefined;
    if (checkpoint && !ending && !/quota|resource_exhausted|unauthenticated|permission_denied|429/i.test(reason)
      && [1000, 1001, 1006, 1011, 1012, 1013].includes(code)) {
      detach();
      options.onstatus("reconnecting", code);
      void connect(checkpoint);
      return;
    }
    closed = true;
    detach();
    options.onclose(code, reason);
  }

  async function connect(checkpoint?: string) {
    if (closed) return;
    const current = generation;
    let setup: LiveServerMessage | undefined;
    let goAway = false;
    let lastError = "";
    const active = () => !closed && current === generation;
    const accept = () => {
      if (!active() || ready || !peer || !setup) return;
      clearTimeout(timer);
      ready = true;
      if (checkpoint) options.onstatus("resumed");
      if (!checkpoint || setup.serverContent || setup.toolCall) options.onmessage(setup);
    };
    timer = setTimeout(() => finish(1013, "Gemini setup timeout"), 25000);
    try {
      const session = await live.connect({
        model: options.model,
        config: {
          ...options.config,
          sessionResumption: checkpoint ? { handle: checkpoint } : {},
          contextWindowCompression: { slidingWindow: {} },
        },
        callbacks: {
          onmessage(message) {
            if (!active()) return;
            if (message.setupComplete) { setup = message; accept(); }
            if (message.toolCall?.functionCalls?.some(call => call.name === "end_call")) ending = true;
            if (!message.setupComplete) options.onmessage(message);
            if (message.goAway) goAway = true;
            if (message.sessionResumptionUpdate) {
              const update = message.sessionResumptionUpdate;
              handle = update.resumable ? update.newHandle : undefined;
              if (goAway && ready && handle && !ending) finish(1000, "goAway");
            }
          },
          onerror(event) {
            if (!active()) return;
            lastError = event.message || "Gemini connection error";
            clearTimeout(timer);
            timer = setTimeout(() => finish(1006, lastError), 1500);
          },
          onclose(event) {
            if (active()) finish(event.code, event.reason || lastError);
          },
        },
      });
      if (!active()) { session.close(); return; }
      peer = session;
      accept();
    } catch (error) {
      if (active()) finish(1011, String(error));
    }
  }

  void Promise.resolve().then(() => connect());
  return {
    sendRealtimeInput(input: Parameters<Session["sendRealtimeInput"]>[0]) {
      if (!ready || !peer) return;
      try { peer.sendRealtimeInput(input); } catch { finish(1006, "Gemini input interrupted"); }
    },
    sendToolResponse(result: Parameters<Session["sendToolResponse"]>[0]) {
      if (ready && peer) peer.sendToolResponse(result);
    },
    close() { closed = true; handle = undefined; detach(); },
  };
}
