import { useEffect, useRef } from "react";

interface WaveformVisualizerProps {
  analyser: AnalyserNode | null;
  isActive: boolean;
  isModelSpeaking: boolean;
  isMuted: boolean;
}

export function WaveformVisualizer({
  analyser,
  isActive,
  isModelSpeaking,
  isMuted,
}: WaveformVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId = 0;
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize);

    const freqData = analyser
      ? new Uint8Array(analyser.frequencyBinCount)
      : new Uint8Array(64);

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;

      ctx.clearRect(0, 0, width, height);

      // Subtle calibration center line
      ctx.strokeStyle = "#E2E8F0";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();

      const barCount = 56;
      const gap = 4;
      const barWidth = Math.max(
        2,
        (width - gap * (barCount - 1)) / barCount
      );

      if (analyser && isActive && !prefersReducedMotion) {
        analyser.getByteFrequencyData(freqData);
      } else {
        freqData.fill(0);
      }

      const activeColor = isModelSpeaking
        ? "#2563EB"
        : isMuted
          ? "#94A3B8"
          : "#0F172A";

      for (let i = 0; i < barCount; i++) {
        let norm = 0;
        if (isActive) {
          const binIndex = Math.min(
            freqData.length - 1,
            Math.floor((i / barCount) * (freqData.length * 0.65))
          );
          norm = freqData[binIndex] / 255;
        }

        const minBar = 3;
        const maxBar = height * 0.78;
        const barHeight = Math.max(minBar, norm * maxBar);
        const x = i * (barWidth + gap);
        const y = (height - barHeight) / 2;

        ctx.fillStyle = isActive && norm > 0.03 ? activeColor : "#CBD5E1";
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 2);
        ctx.fill();
      }

      if (isActive && !prefersReducedMotion) {
        animId = requestAnimationFrame(draw);
      }
    };

    draw();

    return () => {
      window.removeEventListener("resize", resize);
      if (animId) cancelAnimationFrame(animId);
    };
  }, [analyser, isActive, isModelSpeaking, isMuted]);

  return (
    <div className="relative w-full h-36 bg-slate-50 border border-slate-200 rounded-lg overflow-hidden px-4 py-3 flex items-center">
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        aria-label="Визуализатор звуковой волны"
      />
    </div>
  );
}
