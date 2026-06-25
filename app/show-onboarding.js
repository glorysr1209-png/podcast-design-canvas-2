"use strict";

// Show onboarding order for Podcast Design Canvas (#73, #89).
//
// Episode import must come before brand kit in the primary creator path. When a draft
// episode exists, the show home promotes a clear resume action. DOM-free so the UI
// and tests share one source of truth for first-step routing.
(function (global) {
  const FIRST_STEP = "episode-setup";

  function flowApi() {
    if (typeof module !== "undefined" && module.exports && typeof require === "function") {
      return require("./episode-flow.js");
    }
    const g = typeof window !== "undefined" ? window : globalThis;
    return g.PdcEpisodeFlow;
  }

  function firstStepAfterCreateShow() {
    return FIRST_STEP;
  }

  function showDetailSections(show) {
    const episodes = show && Array.isArray(show.episodes) ? show.episodes : [];
    const episodeCount = episodes.length;
    const hasBrandKit = Boolean(show && show.brandKit);
    const FLOW = flowApi();
    const draft = FLOW ? FLOW.latestResumableDraft(episodes) : null;

    if (draft && FLOW) {
      const resume = FLOW.summarizeResumeAction(draft);
      return {
        primary: {
          id: "resume-episode",
          title: resume.title,
          hint: resume.hint,
          actionLabel: resume.actionLabel,
          episodeId: resume.episodeId,
          mode: "resume",
        },
        secondary: {
          id: "brand-kit",
          title: "Brand kit (optional)",
          hint: hasBrandKit
            ? "Reusable logo, colors, and captions — edit any time after your first import."
            : "Set up later. Episode import and speaker context come first.",
          actionLabel: hasBrandKit ? "Edit brand kit" : "Set up brand kit later",
        },
        draftEpisode: draft,
        canStartNewEpisode: true,
      };
    }

    return {
      primary: {
        id: FIRST_STEP,
        title: episodeCount ? "Start or continue an episode" : "Import your recording first",
        hint: episodeCount
          ? "Add a Riverside link or synced speaker files, assign Host / Guest roles, and add social links before style or brand work."
          : "This show has no episodes yet. Import a Riverside link or separate synced speaker files, assign each to Host, Guest 1, or Guest 2, and add social links — then continue to audio polish and style.",
        actionLabel: episodeCount ? "New episode →" : "Set up first episode →",
        mode: "new",
      },
      secondary: {
        id: "brand-kit",
        title: "Brand kit (optional)",
        hint: hasBrandKit
          ? "Reusable logo, colors, and captions — edit any time after your first import."
          : "Set up later. Episode import and speaker context come first.",
        actionLabel: hasBrandKit ? "Edit brand kit" : "Set up brand kit later",
      },
      draftEpisode: null,
      canStartNewEpisode: true,
    };
  }

  const api = {
    FIRST_STEP,
    firstStepAfterCreateShow,
    showDetailSections,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  global.PdcShowOnboarding = api;
}(typeof window !== "undefined" ? window : globalThis));
