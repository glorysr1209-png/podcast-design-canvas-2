"use strict";

// Show identity episode start smoke suite for Podcast Design Canvas (#57).
// Guards prefilling setup, style, template, and brand kit from a saved show.
// Run with: `node tests/show-identity.test.js`.

const assert = require("assert");
const setup = require("../app/episode-setup.js");
const style = require("../app/episode-style.js");
const editor = require("../app/canvas-editor.js");
const templates = require("../app/show-templates.js");
const library = require("../app/show-library.js");
const brandKit = require("../app/show-brand-kit.js");
const identity = require("../app/show-identity.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

function templateStoreForShow() {
  templates._resetTemplateCounter();
  const draft = setup.createDraft();
  draft.episodeName = "Founders Unfiltered #7";
  draft.sourceMode = "upload";
  draft.speakers = [
    Object.assign(setup.createSpeaker("Host"), { name: "Sam Rivera", fileName: "sam.mp4" }),
    Object.assign(setup.createSpeaker("Guest 1"), { name: "Dana Kim", fileName: "dana.mp4" }),
  ];
  const episode = setup.summarize(draft);
  const selection = style.createSelection();
  selection.presetId = "split-stage";
  selection.layout = "split";
  const applied = style.summarizeStyle(selection, episode.speakerCount);
  const doc = editor.createFromStyle(applied, episode, selection);
  let store = templates.createStore();
  store = templates.saveTemplate(store, templates.createTemplate("Founders Format", doc, "tpl-founders"));
  return store;
}

function foundersShow(store) {
  return library.createShow("Founders Unfiltered", {
    id: "show-founders",
    templateId: "tpl-founders",
    templateName: "Founders Format",
    presetName: "Split Stage",
    defaultSourceMode: "riverside",
    defaultRiversideLink: "https://riverside.fm/studio/founders",
    defaultSpeakers: [
      {
        role: "Host",
        name: "Sam Rivera",
        social: { twitter: "https://x.com/samrivera", website: "https://founders.fm" },
      },
      {
        role: "Guest 1",
        name: "Dana Kim",
        social: { linkedin: "https://linkedin.com/in/danakim" },
      },
    ],
    brandKit: brandKit.createBrandKit("show-founders", {
      logoLabel: "Founders mark",
      colors: {
        primary: "#6c4cff",
        secondary: "#10131f",
        background: "#0d1117",
        accent: "#ffb347",
        text: "#f6f7fb",
      },
      typeStyle: "bold-display",
      captionStyle: "big-animated",
    }),
  });
}

test("buildSetupDraft prefills episode name, real speaker names, and social context", () => {
  library._resetCounters();
  const show = foundersShow(templateStoreForShow());
  show.episodes = [{ id: "ep-1", name: "Pilot" }];
  const draft = identity.buildSetupDraft(show);
  assert.strictEqual(draft.episodeName, "Founders Unfiltered — Episode 2");
  assert.strictEqual(draft.sourceMode, "riverside");
  assert.strictEqual(draft.riversideLink, "https://riverside.fm/studio/founders");
  assert.strictEqual(draft.speakers[0].name, "Sam Rivera");
  assert.strictEqual(draft.speakers[1].name, "Dana Kim");
  assert.strictEqual(draft.speakers[0].social.twitter, "https://x.com/samrivera");
  assert.strictEqual(setup.summarize(draft).socialLinkCount, 3);
});

test("buildEpisodeStart carries saved template layout and brand kit into presentation defaults", () => {
  library._resetCounters();
  const store = templateStoreForShow();
  const show = foundersShow(store);
  const start = identity.buildEpisodeStart(show, store);

  assert.strictEqual(start.fromShowIdentity, true);
  assert.strictEqual(start.templateId, "tpl-founders");
  assert.strictEqual(start.templateName, "Founders Format");
  assert.strictEqual(start.styleSelection.presetId, "split-stage");
  assert.strictEqual(start.styleSelection.layout, "split");
  assert.ok(start.canvasDoc);
  assert.strictEqual(start.appliedStyle.presetName, "Split Stage");
  assert.strictEqual(start.appliedStyle.background, "#0d1117");
  assert.strictEqual(start.brandKit.logoLabel, "Founders mark");
  assert.ok(start.identity.lines.some((line) => /Brand kit:/.test(line)));
});

test("buildBlankEpisodeStart preserves the generic new-episode path", () => {
  const blank = identity.buildBlankEpisodeStart();
  assert.strictEqual(blank.fromShowIdentity, false);
  assert.strictEqual(blank.templateId, "");
  assert.strictEqual(blank.brandKit, null);
  assert.strictEqual(blank.setupDraft.sourceMode, "riverside");
  assert.strictEqual(blank.setupDraft.speakers.length, 3);
  assert.strictEqual(blank.appliedStyle, null);
});

test("summarizeShowIdentity reports template, style, and brand kit for workspace/export context", () => {
  const store = templateStoreForShow();
  const show = foundersShow(store);
  const start = identity.buildEpisodeStart(show, store);
  assert.ok(start.identity.identityLine.includes("Founders Format"));
  assert.ok(start.identity.identityLine.includes("Split Stage"));
  assert.ok(start.identity.identityLine.includes("Brand kit:"));
  assert.ok(start.identity.lines.some((line) => /social link/.test(line)));
});

test("ACCEPTANCE: choose a saved show and start a new episode from its established identity", () => {
  library._resetCounters();
  brandKit._resetOverlayCounter();
  const store = templateStoreForShow();
  let lib = library.createLibrary();
  const show = foundersShow(store);
  lib = library.addShow(lib, show);

  const start = identity.buildEpisodeStart(library.getShow(lib, show.id), store);
  assert.strictEqual(start.showName, "Founders Unfiltered");
  assert.strictEqual(start.setupDraft.speakers[0].role, "Host");
  assert.strictEqual(start.appliedStyle.captionStyle, "Big animated captions");
  assert.ok(start.canvasDoc.titleText || start.canvasDoc.presetName);

  const blank = identity.buildBlankEpisodeStart();
  assert.strictEqual(blank.fromShowIdentity, false);
  assert.notStrictEqual(blank.setupDraft.episodeName, start.setupDraft.episodeName);
});

test("ACCEPTANCE: applying a saved show identity/template keeps the episode's assigned cast (#36)", () => {
  library._resetCounters();
  const store = templateStoreForShow();
  const show = foundersShow(store); // defaultSpeakers: Sam Rivera, Dana Kim

  // The creator already assigned a cast that differs from the show defaults.
  const draft = setup.createDraft();
  draft.episodeName = "Episode 12";
  draft.speakers = [
    Object.assign(setup.createSpeaker("Host"), { name: "Marco Vidal" }),
    Object.assign(setup.createSpeaker("Guest 1"), { name: "Lena Park" }),
    Object.assign(setup.createSpeaker("Guest 2"), { name: "Priya Shah" }),
  ];
  const names = (d) => d.speakers.map((s) => s.name);
  const roles = (d) => d.speakers.map((s) => s.role);
  const cast = ["Marco Vidal", "Lena Park", "Priya Shah"];

  // The template's own speakers must never overwrite the current cast.
  assert.deepStrictEqual(names(identity.applyDefaultSpeakers(draft, show)), cast);

  const fromIdentity = identity.buildSetupDraft(show, draft);
  assert.deepStrictEqual(names(fromIdentity), cast);
  assert.deepStrictEqual(roles(fromIdentity), ["Host", "Guest 1", "Guest 2"]);

  const start = identity.buildEpisodeStart(show, store, { currentDraft: draft });
  assert.deepStrictEqual(names(start.setupDraft), cast);
  // ...while the reusable styling/layout/brand from the template are still applied.
  assert.strictEqual(start.appliedStyle.presetName, "Split Stage");
  assert.ok(start.brandKit && start.brandKit.logoLabel === "Founders mark");

  // Applying the saved template canvas rebuilds frames from the CURRENT cast.
  const episode = setup.summarize(draft);
  const tpl = templates.getTemplate(store, "tpl-founders");
  const canvas = templates.applyTemplateForEpisode(tpl, episode, start.styleSelection);
  const frameNames = (canvas.speakerFrames || []).map((f) => f.name);
  assert.ok(frameNames.includes("Marco Vidal"));
  assert.ok(!frameNames.includes("Sam Rivera"));

  // A brand-new episode (no cast yet) still prefills from the show defaults.
  assert.deepStrictEqual(names(identity.buildSetupDraft(show)).slice(0, 2), ["Sam Rivera", "Dana Kim"]);
});

console.log(`\nshow identity: ${passed} assertions passed`);
