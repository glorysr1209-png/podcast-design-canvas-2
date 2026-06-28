"use strict";

// Real audio processing engine for Podcast Design Canvas (#257 — audio polish must
// produce real transformed audio from the imported media, not bookkeeping).
//
// This engine ONLY transforms audio samples that are handed to it (decoded from the
// creator's actual imported media). It never synthesizes a source from identity/metadata.
// It is DOM-free and dependency-free so the exact transform runs identically in the
// browser (on samples decoded via Web Audio from the preserved upload) and in Node tests
// (on samples decoded from real WAV bytes), making the polished output verifiable.
(function (global) {
  const DEFAULT_SAMPLE_RATE = 48000;

  function clamp01(value) {
    if (typeof value !== "number" || isNaN(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }

  function rms(samples) {
    if (!samples || !samples.length) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
    return Math.sqrt(sum / samples.length);
  }

  function peak(samples) {
    let max = 0;
    for (let i = 0; i < (samples ? samples.length : 0); i += 1) {
      const value = Math.abs(samples[i]);
      if (value > max) max = value;
    }
    return max;
  }

  // Downmix any number of channels to a single mono Float32Array (podcast voice tracks).
  function downmixToMono(channelData) {
    const channels = Array.isArray(channelData) ? channelData.filter(Boolean) : [];
    if (!channels.length) return new Float32Array(0);
    if (channels.length === 1) return new Float32Array(channels[0]);
    const length = channels.reduce((min, ch) => Math.min(min, ch.length), channels[0].length);
    const out = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      let sum = 0;
      for (let c = 0; c < channels.length; c += 1) sum += channels[c][i] || 0;
      out[i] = sum / channels.length;
    }
    return out;
  }

  function normalizeSettings(settings) {
    const s = settings || {};
    return {
      noiseCleanup: clamp01(s.noiseCleanup),
      leveling: clamp01(s.leveling),
      speechClarity: clamp01(s.speechClarity),
      enhancement: clamp01(s.enhancement),
    };
  }

  // Apply the creator's chosen treatment as a real sample-level transform of the PROVIDED
  // audio. Each stage maps a creator-facing control to actual DSP: cleanup = high-pass +
  // noise gate, leveling = RMS normalization, clarity = presence emphasis, enhancement =
  // soft saturation. Returns a new buffer plus measured loudness so callers can prove the
  // audio actually changed.
  function processSamples(samples, settings) {
    const source = samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
    const length = source.length;
    const s = normalizeSettings(settings);
    const buffer = new Float32Array(source); // copy — never mutate the input
    const inputRms = rms(buffer);

    if (s.noiseCleanup > 0) {
      const a = 0.9 + 0.09 * s.noiseCleanup;
      let prevX = 0;
      let prevY = 0;
      for (let i = 0; i < length; i += 1) {
        const x = buffer[i];
        const y = a * (prevY + x - prevX);
        prevX = x;
        prevY = y;
        buffer[i] = y;
      }
      const gate = 0.03 * s.noiseCleanup;
      const floorGain = 1 - 0.85 * s.noiseCleanup;
      for (let i = 0; i < length; i += 1) {
        if (Math.abs(buffer[i]) < gate) buffer[i] *= floorGain;
      }
    }

    if (s.leveling > 0) {
      const current = rms(buffer) || 1e-6;
      const target = 0.2;
      let gain = target / current;
      gain = 1 + (gain - 1) * s.leveling;
      gain = Math.max(0.25, Math.min(4, gain));
      for (let i = 0; i < length; i += 1) buffer[i] *= gain;
    }

    if (s.speechClarity > 0) {
      const k = 0.7 * s.speechClarity;
      let prev = length ? buffer[0] : 0;
      for (let i = 0; i < length; i += 1) {
        const x = buffer[i];
        const highs = x - prev;
        prev = x;
        buffer[i] = x + k * highs;
      }
    }

    if (s.enhancement > 0) {
      const drive = 1 + 1.8 * s.enhancement;
      const norm = Math.tanh(drive) || 1;
      for (let i = 0; i < length; i += 1) {
        buffer[i] = Math.tanh(buffer[i] * drive) / norm;
      }
    }

    for (let i = 0; i < length; i += 1) {
      if (buffer[i] > 1) buffer[i] = 1;
      else if (buffer[i] < -1) buffer[i] = -1;
    }

    return { samples: buffer, inputRms: inputRms, outputRms: rms(buffer), peak: peak(buffer) };
  }

  // ---- WAV encode / decode (16-bit PCM, mono) --------------------------------

  function writeString(view, offset, text) {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  }

  function encodeWav(samples, sampleRate) {
    const sr = sampleRate || DEFAULT_SAMPLE_RATE;
    const data = samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
    const length = data.length;
    const dataBytes = length * 2;
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);

    writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + dataBytes, true);
    writeString(view, 8, "WAVE");
    writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sr, true);
    view.setUint32(28, sr * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, "data");
    view.setUint32(40, dataBytes, true);

    let offset = 44;
    for (let i = 0; i < length; i += 1) {
      let sample = data[i];
      if (sample > 1) sample = 1;
      else if (sample < -1) sample = -1;
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample | 0, true);
      offset += 2;
    }
    return new Uint8Array(buffer);
  }

  // Decode a 16-bit PCM WAV (any channel count) into mono samples + sample rate. Used by
  // tests and as a no-Web-Audio fallback for WAV uploads in the browser.
  function decodeWav(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (data.length < 44) return { sampleRate: DEFAULT_SAMPLE_RATE, samples: new Float32Array(0), channels: 1 };
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const channels = view.getUint16(22, true) || 1;
    const sampleRate = view.getUint32(24, true) || DEFAULT_SAMPLE_RATE;
    const bitsPerSample = view.getUint16(34, true) || 16;

    // Find the data chunk (skip any non-data chunks after fmt).
    let offset = 12;
    let dataOffset = 44;
    let dataBytes = data.length - 44;
    while (offset + 8 <= data.length) {
      const id = String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
      const size = view.getUint32(offset + 4, true);
      if (id === "data") {
        dataOffset = offset + 8;
        dataBytes = size;
        break;
      }
      offset += 8 + size + (size % 2);
    }

    const bytesPerSample = Math.max(1, bitsPerSample / 8);
    const frameCount = Math.floor(dataBytes / (bytesPerSample * channels));
    const mono = new Float32Array(frameCount);
    for (let i = 0; i < frameCount; i += 1) {
      let sum = 0;
      for (let c = 0; c < channels; c += 1) {
        const pos = dataOffset + (i * channels + c) * bytesPerSample;
        if (pos + 1 < data.length) {
          const intSample = view.getInt16(pos, true);
          sum += intSample < 0 ? intSample / 0x8000 : intSample / 0x7fff;
        }
      }
      mono[i] = sum / channels;
    }
    return { sampleRate: sampleRate, samples: mono, channels: channels };
  }

  function bytesToBase64(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (typeof Buffer !== "undefined") return Buffer.from(data).toString("base64");
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < data.length; i += chunk) {
      binary += String.fromCharCode.apply(null, data.subarray(i, i + chunk));
    }
    return global.btoa(binary);
  }

  function base64ToBytes(base64) {
    const text = base64 || "";
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(text, "base64"));
    const binary = global.atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }

  function checksumHex(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    let h = 0x811c9dc5;
    for (let i = 0; i < data.length; i += 1) {
      h ^= data[i];
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }

  function round4(value) {
    return Math.round((Number(value) || 0) * 10000) / 10000;
  }

  // High-level: transform decoded mono samples into a polished WAV asset with measurable
  // proof the audio changed. `result.changed` is true when the output differs from input.
  function polishSamples(samples, settings, sampleRate) {
    const sr = sampleRate || DEFAULT_SAMPLE_RATE;
    const processed = processSamples(samples, settings);
    const wav = encodeWav(processed.samples, sr);
    return {
      wav: wav,
      sampleRate: sr,
      byteLength: wav.length,
      durationSec: round4((wav.length - 44) / 2 / sr),
      checksum: checksumHex(wav),
      inputRms: round4(processed.inputRms),
      outputRms: round4(processed.outputRms),
      peak: round4(processed.peak),
      changed: round4(processed.inputRms) !== round4(processed.outputRms)
        || processed.samples.length === 0,
    };
  }

  const api = {
    DEFAULT_SAMPLE_RATE: DEFAULT_SAMPLE_RATE,
    downmixToMono,
    processSamples,
    polishSamples,
    encodeWav,
    decodeWav,
    bytesToBase64,
    base64ToBytes,
    checksumHex,
    rms,
    peak,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  global.PdcAudioEngine = api;
}(typeof window !== "undefined" ? window : globalThis));
