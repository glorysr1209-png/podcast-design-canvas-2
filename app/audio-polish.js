"use strict";

// Creator-facing audio polish model for Podcast Design Canvas (#15).
//
// Presents noise cleanup, leveling, speech clarity, and enhancement as simple quality
// choices tied to each imported speaker track — not technical audio processing settings.
// DOM-free so the polish step and tests share one source of truth.
(function (global) {
  const QUALITY_PRESETS = [
    {
      id: "natural",
      name: "Natural",
      tagline: "Light touch — keeps the room feel with gentle cleanup.",
    },
    {
      id: "clean",
      name: "Clean",
      tagline: "Balanced polish for most podcast conversations.",
    },
    {
      id: "studio",
      name: "Studio",
      tagline: "Broadcast-ready clarity and presence.",
    },
  ];

  const CONTROLS = [
    {
      id: "noiseCleanup",
      label: "Noise cleanup",
      hint: "Reduce background hum, fan noise, and room rumble.",
    },
    {
      id: "leveling",
      label: "Voice leveling",
      hint: "Even out volume between speakers and moments.",
    },
    {
      id: "speechClarity",
      label: "Speech clarity",
      hint: "Bring forward consonants and vocal presence.",
    },
    {
      id: "enhancement",
      label: "Overall enhancement",
      hint: "Add warmth and polish without sounding overprocessed.",
    },
  ];

  const LEVELS = [
    { id: "light", label: "Light" },
    { id: "balanced", label: "Balanced" },
    { id: "strong", label: "Strong" },
  ];

  const PRESET_LEVELS = {
    natural: {
      noiseCleanup: "light",
      leveling: "light",
      speechClarity: "light",
      enhancement: "light",
    },
    clean: {
      noiseCleanup: "balanced",
      leveling: "balanced",
      speechClarity: "balanced",
      enhancement: "balanced",
    },
    studio: {
      noiseCleanup: "strong",
      leveling: "strong",
      speechClarity: "strong",
      enhancement: "strong",
    },
  };

  function defaultPreset() {
    return QUALITY_PRESETS[1];
  }

  function getPreset(id) {
    return QUALITY_PRESETS.find((preset) => preset.id === id) || defaultPreset();
  }

  function getLevel(id) {
    return LEVELS.find((level) => level.id === id) || LEVELS[1];
  }

  function getControl(id) {
    return CONTROLS.find((control) => control.id === id) || CONTROLS[0];
  }

  function buildSpeakerTracks(episodeSummary) {
    const sourceMode = episodeSummary && episodeSummary.sourceMode ? episodeSummary.sourceMode : "";
    const speakers = episodeSummary && Array.isArray(episodeSummary.speakers)
      ? episodeSummary.speakers
      : [];
    return speakers.map((speaker, index) => {
      const sourceMedia = speaker && speaker.sourceMedia && typeof speaker.sourceMedia === "object"
        ? speaker.sourceMedia
        : null;
      const byteLength = sourceMedia ? Number(sourceMedia.byteLength) || 0 : 0;
      const assetId = sourceMedia ? sourceMedia.assetId || sourceMedia.id || "" : "";
      return {
        role: (speaker && speaker.role) || "Speaker",
        name: (speaker && speaker.name) || "Unnamed speaker",
        sourceLabel: (speaker && speaker.sourceLabel) || "Source track",
        sourceMode: sourceMode,
        sourceMedia: sourceMedia,
        hasSourceMedia: Boolean(sourceMedia && assetId && byteLength > 0),
        trackIndex: index + 1,
      };
    });
  }

  function createPolish(episodeSummary) {
    const preset = defaultPreset();
    const levels = PRESET_LEVELS[preset.id];
    return {
      presetId: preset.id,
      noiseCleanup: levels.noiseCleanup,
      leveling: levels.leveling,
      speechClarity: levels.speechClarity,
      enhancement: levels.enhancement,
      speakers: buildSpeakerTracks(episodeSummary),
    };
  }

  function applyPreset(polish, presetId) {
    const preset = getPreset(presetId);
    const levels = PRESET_LEVELS[preset.id] || PRESET_LEVELS.clean;
    return Object.assign({}, polish || createPolish({}), {
      presetId: preset.id,
      noiseCleanup: levels.noiseCleanup,
      leveling: levels.leveling,
      speechClarity: levels.speechClarity,
      enhancement: levels.enhancement,
      speakers: polish && polish.speakers ? polish.speakers.slice() : [],
    });
  }

  function updateControl(polish, controlId, levelId) {
    const next = Object.assign({}, polish || createPolish({}));
    if (CONTROLS.some((control) => control.id === controlId)) {
      next[controlId] = getLevel(levelId).id;
    }
    return next;
  }

  function speakerIndicator(polish, speaker) {
    const preset = getPreset(polish && polish.presetId);
    const name = (speaker && speaker.name) || "Speaker";
    const sourceCue = speaker && speaker.sourceMode === "upload"
      ? (speaker.hasSourceMedia ? "source media saved" : "source media pending")
      : "source linked";
    return `${preset.name} treatment · ${name} · ${sourceCue}`;
  }

  // ---- Real processing settings + outputs (#257) -----------------------------
  // The creator-facing Light/Balanced/Strong choices map to processing intensities the
  // audio engine applies as real DSP to the decoded imported media.
  const LEVEL_INTENSITY = { light: 0.34, balanced: 0.67, strong: 1 };

  function intensityFor(levelId) {
    return Object.prototype.hasOwnProperty.call(LEVEL_INTENSITY, levelId)
      ? LEVEL_INTENSITY[levelId]
      : LEVEL_INTENSITY.balanced;
  }

  function levelsToSettings(polish) {
    const state = polish || createPolish({});
    return {
      noiseCleanup: intensityFor(state.noiseCleanup),
      leveling: intensityFor(state.leveling),
      speechClarity: intensityFor(state.speechClarity),
      enhancement: intensityFor(state.enhancement),
    };
  }

  function settingsSignature(polish) {
    const state = polish || createPolish({});
    return [state.presetId, state.noiseCleanup, state.leveling, state.speechClarity, state.enhancement].join(":");
  }

  function outputSlug(value) {
    const text = (typeof value === "string" ? value : "").trim().toLowerCase();
    const slug = text.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return slug || "track";
  }

  function polishedFileName(name, role, presetId) {
    const stem = outputSlug(name && name !== "Unnamed speaker" ? name : role);
    return `${stem}-${presetId || "polish"}-polished.wav`;
  }

  // Build the per-track polished record from REAL engine output metadata produced by
  // processing the imported media bytes. `output` carries the actual byteLength, duration,
  // checksum, and measured loudness of the encoded polished WAV.
  function buildPolishedRecord(speaker, presetId, output) {
    const data = output || {};
    const role = (speaker && speaker.role) || "Speaker";
    const name = (speaker && speaker.name) || "Unnamed speaker";
    return {
      trackIndex: (speaker && speaker.trackIndex) || 1,
      role: role,
      name: name,
      status: data.byteLength > 44 ? "polished" : "failed",
      presetId: presetId,
      fileName: polishedFileName(name, role, presetId),
      assetId: data.assetId || "",
      byteLength: Number(data.byteLength) || 0,
      durationSec: Number(data.durationSec) || 0,
      checksum: data.checksum || "",
      inputRms: Number(data.inputRms) || 0,
      outputRms: Number(data.outputRms) || 0,
      peak: Number(data.peak) || 0,
      changed: Boolean(data.changed),
      sampleRate: Number(data.sampleRate) || 0,
      fromRealMedia: Boolean(data.fromRealMedia),
      original: {
        sourceLabel: (speaker && speaker.sourceLabel) || "",
        assetId: (speaker && speaker.sourceMedia && speaker.sourceMedia.assetId) || "",
        byteLength: (speaker && speaker.sourceMedia && Number(speaker.sourceMedia.byteLength)) || 0,
      },
    };
  }

  function restorePolish(appliedSummary, episodeSummary) {
    const applied = appliedSummary || {};
    const base = createPolish(episodeSummary);
    return Object.assign(base, {
      presetId: applied.presetId || base.presetId,
      noiseCleanup: applied.noiseCleanup || base.noiseCleanup,
      leveling: applied.leveling || base.leveling,
      speechClarity: applied.speechClarity || base.speechClarity,
      enhancement: applied.enhancement || base.enhancement,
    });
  }

  function summarizePolish(polish, applied) {
    const state = polish || createPolish({});
    const preset = getPreset(state.presetId);
    const controlSummary = CONTROLS.map((control) => {
      const level = getLevel(state[control.id]);
      return `${control.label}: ${level.label}`;
    });
    const speakers = Array.isArray(state.speakers) ? state.speakers : [];
    const sourceMediaCount = speakers.reduce((total, speaker) => total + (speaker && speaker.hasSourceMedia ? 1 : 0), 0);
    const summary = {
      presetId: preset.id,
      presetName: preset.name,
      tagline: preset.tagline,
      noiseCleanup: state.noiseCleanup,
      noiseCleanupLabel: getLevel(state.noiseCleanup).label,
      leveling: state.leveling,
      levelingLabel: getLevel(state.leveling).label,
      speechClarity: state.speechClarity,
      speechClarityLabel: getLevel(state.speechClarity).label,
      enhancement: state.enhancement,
      enhancementLabel: getLevel(state.enhancement).label,
      speakerCount: speakers.length,
      sourceMediaCount,
      sourceMediaReady: speakers.length > 0 && sourceMediaCount === speakers.length,
      treatmentLine: controlSummary.join(" · "),
      signature: settingsSignature(state),
      polished: false,
      polishedTrackCount: 0,
    };
    if (applied && applied.complete && Array.isArray(applied.tracks)) {
      const saved = applied.tracks.filter((track) => track && track.status === "polished");
      summary.polished = saved.length > 0;
      summary.polishedTrackCount = saved.length;
      summary.polishedSignature = applied.signature || summary.signature;
      summary.polishedBytes = saved.reduce((total, track) => total + (track.byteLength || 0), 0);
      summary.polishedRealMediaCount = saved.reduce((total, track) => total + (track.fromRealMedia ? 1 : 0), 0);
      summary.polishedTracks = saved.map((track) => ({
        trackIndex: track.trackIndex,
        role: track.role,
        name: track.name,
        status: track.status,
        fileName: track.fileName,
        assetId: track.assetId,
        byteLength: track.byteLength,
        durationSec: track.durationSec,
        checksum: track.checksum,
        changed: track.changed,
        fromRealMedia: track.fromRealMedia,
      }));
      summary.appliedAt = applied.appliedAt || Date.now();
    }
    return summary;
  }

  // Episode review / export path — rolls audio treatment up with other episode choices.
  function buildReviewSummary(episodeSummary, polishSummary, extras) {
    const episode = episodeSummary || {};
    const audio = polishSummary || {};
    const options = extras || {};
    const lines = [];
    if (audio.presetName) {
      lines.push(`Audio: ${audio.presetName} (${audio.treatmentLine})`);
    }
    if (audio.polishedTrackCount) {
      lines.push(`Audio outputs: ${audio.polishedTrackCount} polished WAV track${audio.polishedTrackCount === 1 ? "" : "s"} rendered (export uses these, not the raw originals)`);
    }
    if (options.styleName) {
      lines.push(`Visual style: ${options.styleName}`);
    }
    if (options.templateName) {
      lines.push(`Show template: ${options.templateName}`);
    }
    return {
      episodeName: episode.episodeName || "",
      speakerCount: episode.speakerCount || 0,
      audioPreset: audio.presetName || "",
      audioTreatment: audio.treatmentLine || "",
      polishedTrackCount: audio.polishedTrackCount || 0,
      styleName: options.styleName || "",
      templateName: options.templateName || "",
      readyForExport: Boolean(audio.presetName),
      summaryLines: lines,
    };
  }

  const api = {
    QUALITY_PRESETS,
    CONTROLS,
    LEVELS,
    defaultPreset,
    getPreset,
    getLevel,
    getControl,
    buildSpeakerTracks,
    createPolish,
    applyPreset,
    updateControl,
    speakerIndicator,
    levelsToSettings,
    settingsSignature,
    polishedFileName,
    buildPolishedRecord,
    restorePolish,
    summarizePolish,
    buildReviewSummary,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  global.PdcAudioPolish = api;
}(typeof window !== "undefined" ? window : globalThis));
