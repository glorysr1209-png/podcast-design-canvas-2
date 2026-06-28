"use strict";

// Verifies #257: applying audio polish produces real, rendered polished audio derived from
// the imported media bytes (not bookkeeping records), and that the review/export steps
// consume those rendered outputs. The browser decodes the preserved upload via Web Audio;
// here we drive the exact same engine + model pipeline on real WAV bytes so the rendered
// output is verifiable in Node.

const assert = require("assert");
const setup = require("../app/episode-setup.js");
const audio = require("../app/audio-polish.js");
const engine = require("../app/audio-engine.js");
const exportApi = require("../app/episode-export.js");
const review = require("../app/publish-review.js");
const style = require("../app/episode-style.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

const SR = 48000;

function recordingBytes(seed) {
  const frames = 2400;
  const amp = 0.25 + (seed % 5) * 0.03;
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    samples[i] = amp * Math.sin((2 * Math.PI * (180 + seed * 20) * i) / SR)
      + 0.02 * Math.sin((2 * Math.PI * 9000 * i) / SR);
  }
  return engine.encodeWav(samples, SR);
}

function uploadEpisode() {
  const draft = setup.createDraft();
  draft.episodeName = "Founders Unfiltered #7";
  draft.sourceMode = "upload";
  draft.speakers = [
    Object.assign(setup.createSpeaker("Host"), { name: "Sam Rivera", fileName: "sam.wav" }),
    Object.assign(setup.createSpeaker("Guest 1"), { name: "Dana Kim", fileName: "dana.wav" }),
  ];
  draft.speakers.forEach((speaker, index) => {
    setup.attachSourceMediaAsset(speaker, {
      assetId: `real-media-${index + 1}`,
      fileName: speaker.fileName,
      fileSize: recordingBytes(index + 1).length,
      mimeType: "audio/wav",
      storage: "indexedDB",
    });
  });
  return setup.summarize(draft);
}

// Mirror of episode-setup.ui.js applyAudioPolishReal(), but decoding the test's real WAV
// bytes directly through the engine's WAV decoder instead of Web Audio.
function renderPolish(polish) {
  const settings = audio.levelsToSettings(polish);
  const signature = audio.settingsSignature(polish);
  const tracks = polish.speakers.map((speaker, index) => {
    const decoded = engine.decodeWav(recordingBytes(index + 1));
    const result = engine.polishSamples(decoded.samples, settings, decoded.sampleRate);
    return audio.buildPolishedRecord(speaker, polish.presetId, {
      assetId: `polished:real-media-${index + 1}:${signature}`,
      byteLength: result.byteLength,
      durationSec: result.durationSec,
      checksum: result.checksum,
      inputRms: result.inputRms,
      outputRms: result.outputRms,
      peak: result.peak,
      changed: result.changed,
      sampleRate: result.sampleRate,
      fromRealMedia: true,
    });
  });
  const polished = tracks.filter((track) => track.status === "polished");
  return {
    complete: tracks.length > 0 && polished.length === tracks.length,
    presetId: polish.presetId,
    signature: signature,
    tracks: tracks,
    appliedAt: Date.now(),
  };
}

test("apply renders a real polished WAV for every assigned speaker", () => {
  const episode = uploadEpisode();
  const polish = audio.createPolish(episode);
  const applied = renderPolish(polish);

  assert.strictEqual(applied.complete, true);
  assert.strictEqual(applied.tracks.length, 2);
  applied.tracks.forEach((track) => {
    assert.strictEqual(track.status, "polished");
    assert.ok(track.byteLength > 44, "rendered real WAV bytes");
    assert.ok(track.changed, "audio measurably transformed");
    assert.strictEqual(track.fromRealMedia, true);
    assert.ok(/\.wav$/.test(track.fileName));
    assert.ok(track.checksum.length > 0);
  });
});

test("polished outputs are distinct per source and stable per quality choice", () => {
  const episode = uploadEpisode();
  const polish = audio.createPolish(episode);
  const first = renderPolish(polish);
  const again = renderPolish(polish);

  assert.notStrictEqual(first.tracks[0].checksum, first.tracks[1].checksum, "different source audio -> different output");
  assert.strictEqual(first.tracks[0].checksum, again.tracks[0].checksum, "same settings -> identical render");

  const studio = audio.applyPreset(polish, "studio");
  const studioApplied = renderPolish(studio);
  assert.notStrictEqual(first.tracks[0].checksum, studioApplied.tracks[0].checksum, "different quality -> different render");
});

test("summarizePolish records polished outputs only after a complete apply", () => {
  const episode = uploadEpisode();
  const polish = audio.createPolish(episode);

  const before = audio.summarizePolish(polish);
  assert.strictEqual(before.polished, false);
  assert.strictEqual(before.polishedTrackCount, 0);

  const applied = renderPolish(polish);
  const after = audio.summarizePolish(polish, applied);
  assert.strictEqual(after.polished, true);
  assert.strictEqual(after.polishedTrackCount, 2);
  assert.strictEqual(after.polishedRealMediaCount, 2);
  assert.ok(after.polishedBytes > 0);
  assert.strictEqual(after.polishedTracks.length, 2);
  assert.ok(after.polishedTracks[0].checksum.length > 0);
});

test("restorePolish rebuilds the editable settings from a saved apply", () => {
  const episode = uploadEpisode();
  const polish = audio.applyPreset(audio.createPolish(episode), "studio");
  const applied = renderPolish(polish);
  const summary = audio.summarizePolish(polish, applied);

  const restored = audio.restorePolish(summary, episode);
  assert.strictEqual(restored.presetId, "studio");
  assert.strictEqual(audio.settingsSignature(restored), audio.settingsSignature(polish));
});

test("review and export consume the rendered polished tracks, not the raw originals", () => {
  const episode = uploadEpisode();
  const polish = audio.createPolish(episode);
  const applied = renderPolish(polish);
  const polishSummary = audio.summarizePolish(polish, applied);

  const selection = style.createSelection();
  const ctx = {
    audioPolish: polishSummary,
    appliedStyle: style.summarizeStyle(selection, episode.speakerCount),
    templateName: "Founders Unfiltered",
  };

  const result = review.createReview(episode, ctx);
  const audioCheck = result.checks.find((c) => c.id === "audio-ready");
  assert.ok(audioCheck, "audio-ready check present");
  assert.ok(/polished WAV/.test(audioCheck.message), "review surfaces rendered WAV tracks");

  const job = exportApi.createExport(episode, { templateName: "Founders Unfiltered" });
  const finalSummary = exportApi.buildFinalSummary(episode, ctx, job);
  assert.ok(finalSummary.lines.some((line) => line.indexOf("Audio outputs:") === 0), "export references polished outputs");

  const reviewSummary = audio.buildReviewSummary(episode, polishSummary, {});
  assert.ok(reviewSummary.summaryLines.some((line) => /polished WAV/.test(line)));
});

test("ACCEPTANCE: upload media, apply, render real polished WAVs, persist and export them", () => {
  const episode = uploadEpisode();
  const polish = audio.createPolish(episode);

  const applied = renderPolish(polish);
  assert.strictEqual(applied.complete, true);
  applied.tracks.forEach((track) => {
    assert.ok(track.byteLength > 44 && track.changed && track.fromRealMedia);
  });

  // Persist -> reload round trip (JSON, as localStorage would store it).
  const summary = audio.summarizePolish(polish, applied);
  const reloaded = JSON.parse(JSON.stringify(summary));
  assert.strictEqual(reloaded.polished, true);
  assert.strictEqual(reloaded.polishedTrackCount, 2);
  assert.strictEqual(reloaded.polishedTracks[0].checksum, summary.polishedTracks[0].checksum);

  const ctx = {
    audioPolish: reloaded,
    appliedStyle: style.summarizeStyle(style.createSelection(), episode.speakerCount),
    templateName: "Founders Unfiltered",
  };
  const job = exportApi.createExport(episode, { templateName: "Founders Unfiltered" });
  const finalSummary = exportApi.buildFinalSummary(episode, ctx, job);
  assert.ok(finalSummary.lines.some((line) => /rendered polished WAV/.test(line)));
});

console.log(`\naudio polish real outputs: ${passed} assertions passed`);
