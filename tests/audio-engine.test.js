"use strict";

const assert = require("assert");
const engine = require("../app/audio-engine.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

const SR = 48000;

// A deterministic stand-in for an imported recording's decoded samples (tone + a little
// high-frequency hiss). The engine only ever transforms samples handed to it like these.
function recording(frames, amplitude) {
  const amp = typeof amplitude === "number" ? amplitude : 0.3;
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    out[i] = amp * Math.sin((2 * Math.PI * 220 * i) / SR)
      + 0.02 * Math.sin((2 * Math.PI * 9000 * i) / SR);
  }
  return out;
}

const SETTINGS = { noiseCleanup: 1, leveling: 1, speechClarity: 1, enhancement: 1 };

test("encodeWav writes a valid 16-bit PCM WAV that decodeWav reads back", () => {
  const samples = recording(4800);
  const wav = engine.encodeWav(samples, SR);
  assert.ok(wav instanceof Uint8Array, "encodeWav returns bytes");
  assert.strictEqual(wav.length, 44 + samples.length * 2, "header + 16-bit samples");
  assert.strictEqual(String.fromCharCode(wav[0], wav[1], wav[2], wav[3]), "RIFF");
  assert.strictEqual(String.fromCharCode(wav[8], wav[9], wav[10], wav[11]), "WAVE");

  const decoded = engine.decodeWav(wav);
  assert.strictEqual(decoded.sampleRate, SR);
  assert.strictEqual(decoded.samples.length, samples.length);
  for (let i = 0; i < samples.length; i += 400) {
    assert.ok(Math.abs(decoded.samples[i] - samples[i]) < 0.001, "round-trips within 16-bit error");
  }
});

test("processing transforms the PROVIDED audio bytes (output differs from input)", () => {
  const inputWav = engine.encodeWav(recording(4800), SR);
  const decoded = engine.decodeWav(inputWav);

  const result = engine.polishSamples(decoded.samples, SETTINGS, decoded.sampleRate);
  assert.strictEqual(result.byteLength, 44 + decoded.samples.length * 2);
  assert.ok(result.outputRms > 0, "rendered audio has signal");
  assert.ok(result.changed, "loudness measurably changed after processing");
  assert.notStrictEqual(result.checksum, engine.checksumHex(inputWav), "polished bytes differ from the source bytes");
});

test("the polished output is a function of the input content, not synthesized from nothing", () => {
  const loud = engine.polishSamples(recording(4800, 0.4), SETTINGS, SR);
  const quiet = engine.polishSamples(recording(4800, 0.1), SETTINGS, SR);
  assert.notStrictEqual(loud.checksum, quiet.checksum, "different source audio -> different polished output");
});

test("processing is deterministic and varies by quality choice", () => {
  const samples = engine.decodeWav(engine.encodeWav(recording(2400), SR)).samples;
  const a = engine.polishSamples(samples, SETTINGS, SR);
  const b = engine.polishSamples(samples, SETTINGS, SR);
  assert.strictEqual(a.checksum, b.checksum, "same input + settings -> identical bytes");

  const light = engine.polishSamples(samples, { noiseCleanup: 0.34, leveling: 0.34, speechClarity: 0.34, enhancement: 0.34 }, SR);
  assert.notStrictEqual(a.checksum, light.checksum, "stronger settings -> different bytes");
});

test("empty input yields an empty WAV (never fabricates a source)", () => {
  const result = engine.polishSamples([], SETTINGS, SR);
  assert.strictEqual(result.byteLength, 44, "header only, no synthesized samples");
});

test("downmixToMono averages multi-channel input", () => {
  const left = new Float32Array([1, 0, -1]);
  const right = new Float32Array([0, 0, -1]);
  const mono = engine.downmixToMono([left, right]);
  assert.strictEqual(mono.length, 3);
  assert.ok(Math.abs(mono[0] - 0.5) < 1e-6);
  assert.ok(Math.abs(mono[2] + 1) < 1e-6);
});

test("base64 helpers round-trip the encoded WAV bytes", () => {
  const wav = engine.encodeWav(recording(1200), SR);
  const restored = engine.base64ToBytes(engine.bytesToBase64(wav));
  assert.strictEqual(restored.length, wav.length);
  assert.deepStrictEqual(Array.from(restored.subarray(0, 64)), Array.from(wav.subarray(0, 64)));
});

console.log(`\naudio engine: ${passed} assertions passed`);
