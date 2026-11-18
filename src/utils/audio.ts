/**
 * Audio encoding, resampling, gapless 24kHz PCM playback, and WAV export utilities.
 */

export function float32ToInt16Base64(
  float32Data: Float32Array,
  sourceSampleRate: number,
  targetSampleRate = 16000
): string {
  let samples = float32Data;

  if (sourceSampleRate !== targetSampleRate) {
    const ratio = sourceSampleRate / targetSampleRate;
    const newLength = Math.max(1, Math.floor(float32Data.length / ratio));
    const resampled = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const srcIndex = i * ratio;
      const idx0 = Math.floor(srcIndex);
      const idx1 = Math.min(idx0 + 1, float32Data.length - 1);
      const frac = srcIndex - idx0;
      resampled[i] = float32Data[idx0] * (1 - frac) + float32Data[idx1] * frac;
    }
    samples = resampled;
  }

  const int16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }

  return uint8ToBase64(new Uint8Array(int16.buffer));
}

export function uint8ToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function pcm16Base64ToFloat32(base64: string): Float32Array {
  const bytes = base64ToUint8(base64);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numSamples = Math.floor(bytes.byteLength / 2);
  const float32 = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const int16 = view.getInt16(i * 2, true);
    float32[i] = int16 / 32768;
  }
  return float32;
}

export function createWavBlobFromPcmChunks(
  chunks: Uint8Array[],
  sampleRate = 24000,
  numChannels = 1
): Blob {
  const totalPcmBytes = chunks.reduce((acc, c) => acc + c.byteLength, 0);
  const buffer = new ArrayBuffer(44 + totalPcmBytes);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + totalPcmBytes, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true); // byte rate
  view.setUint16(32, numChannels * 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, totalPcmBytes, true);

  const out = new Uint8Array(buffer, 44);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

export function createWavBlobFromBase64(base64Wav: string): Blob {
  const bytes = base64ToUint8(base64Wav);
  return new Blob([bytes.buffer as ArrayBuffer], { type: "audio/wav" });
}

export function getWavDurationSeconds(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    const url = URL.createObjectURL(blob);
    audio.src = url;
    audio.addEventListener("loadedmetadata", () => {
      const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
      URL.revokeObjectURL(url);
      resolve(dur);
    });
    audio.addEventListener("error", () => {
      URL.revokeObjectURL(url);
      resolve(0);
    });
  });
}

export function formatTimeSec(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(mins).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}
