"use strict";

// Reusable show template smoke suite for Podcast Design Canvas (#27).
// Guards the documented acceptance: save a customized layout/style as a named show
// template, list it in a library, select it, and apply it to a NEW episode so the saved
// show identity carries forward while the current episode's speaker assignments are kept.
// Run with: `node tests/show-templates.test.js`.

const assert = require("assert");
const setup = require("../app/episode-setup.js");
const style = require("../app/episode-style.js");
const editor = require("../app/canvas-editor.js");
const templates = require("../app/show-templates.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

function episodeWith(name, speakers) {
  const draft = setup.createDraft();
  draft.episodeName = name;
  draft.sourceMode = "upload";
  draft.speakers = speakers.map((sp) =>
    Object.assign(setup.createSpeaker(sp.role), { name: sp.name, fileName: `${sp.name.split(" ")[0].toLowerCase()}.mp4` }),
  );
  return setup.summarize(draft);
}

function customizedCanvas(episode, presetId, titleText) {
  const selection = style.createSelection();
  selection.presetId = presetId;
  const applied = style.summarizeStyle(selection, episode.speakerCount);
  let doc = editor.createFromStyle(applied, episode, selection);
  doc = editor.updateElement(doc, "titleText", titleText);
  return doc;
}

test("SAVING: a customized canvas is saved as a named show template", () => {
  templates._resetTemplateCounter();
  const episode = episodeWith("Founders Unfiltered #7", [
    { role: "Host", name: "Sam Rivera" },
    { role: "Guest 1", name: "Dana Kim" },
  ]);
  const doc = customizedCanvas(episode, "studio-spotlight", "Founders Show Look");

  let store = templates.createStore();
  const check = templates.validateTemplateName(store, "Founders Show");
  assert.strictEqual(check.ok, true);
  const template = templates.createTemplate(check.name, doc, "tpl-founders");
  store = templates.saveTemplate(store, template);
  assert.strictEqual(templates.listTemplates(store).length, 1);
});

test("LISTING: the library exposes name + identity metadata", () => {
  templates._resetTemplateCounter();
  const episode = episodeWith("Show A", [{ role: "Host", name: "Sam Rivera" }]);
  let store = templates.createStore();
  store = templates.saveTemplate(store, templates.createTemplate("Weeknight Live", customizedCanvas(episode, "panel-grid", "Weeknight"), "tpl-1"));
  store = templates.saveTemplate(store, templates.createTemplate("Deep Dive", customizedCanvas(episode, "split-stage", "Deep Dive"), "tpl-2"));

  const list = templates.listTemplates(store);
  assert.strictEqual(list.length, 2);
  const names = list.map((item) => item.name);
  assert.ok(names.indexOf("Weeknight Live") >= 0 && names.indexOf("Deep Dive") >= 0);
  const weeknight = list.find((item) => item.name === "Weeknight Live");
  assert.strictEqual(weeknight.presetName, "Panel Grid");
  assert.strictEqual(weeknight.titleText, "Weeknight");
});

test("SELECTING: a saved template can be reselected by id", () => {
  templates._resetTemplateCounter();
  const episode = episodeWith("Show A", [{ role: "Host", name: "Sam Rivera" }]);
  let store = templates.createStore();
  store = templates.saveTemplate(store, templates.createTemplate("My Show", customizedCanvas(episode, "studio-spotlight", "My Show Look"), "tpl-mine"));

  const reselected = templates.getTemplate(store, "tpl-mine");
  assert.ok(reselected, "the saved template is available for future episodes");
  assert.strictEqual(reselected.canvas.titleText, "My Show Look");
  assert.strictEqual(templates.getTemplate(store, "tpl-missing"), null);
});

test("APPLYING: the saved identity carries forward while the new episode's speakers are kept", () => {
  templates._resetTemplateCounter();
  // Save a template from a 2-speaker episode.
  const showA = episodeWith("Show A — Episode 1", [
    { role: "Host", name: "Sam Rivera" },
    { role: "Guest 1", name: "Dana Kim" },
  ]);
  const docA = customizedCanvas(showA, "studio-spotlight", "Signature Show Look");
  let store = templates.createStore();
  store = templates.saveTemplate(store, templates.createTemplate("Signature", docA, "tpl-sig"));

  // A different episode with a different cast picks the saved template.
  const showB = episodeWith("Show A — Episode 2", [
    { role: "Host", name: "Priya Patel" },
    { role: "Guest 1", name: "Marco Vidal" },
    { role: "Guest 2", name: "Lena Frost" },
  ]);
  const savedCanvas = templates.applyTemplate(templates.getTemplate(store, "tpl-sig"));
  const adapted = editor.applyToEpisode(savedCanvas, showB, { layout: savedCanvas.layoutId });

  // Identity preserved from the template…
  assert.strictEqual(adapted.titleText, "Signature Show Look");
  assert.strictEqual(adapted.presetName, "Studio Spotlight");
  assert.ok(adapted.layers.length >= 5, "saved layer stack carried forward");
  // …but the speaker frames are this episode's cast, not Show A's.
  assert.strictEqual(adapted.speakerFrames.length, 3);
  assert.deepStrictEqual(adapted.speakerFrames.map((f) => f.name), ["Priya Patel", "Marco Vidal", "Lena Frost"]);
});

// End-to-end: customize → save → list → select → apply to a new episode.
test("ACCEPTANCE: save a show template and reuse it on a new episode", () => {
  templates._resetTemplateCounter();
  const showA = episodeWith("Founders Unfiltered #7", [
    { role: "Host", name: "Sam Rivera" },
    { role: "Guest 1", name: "Dana Kim" },
  ]);
  const docA = customizedCanvas(showA, "bold-broadcast", "Founders House Style");

  let store = templates.createStore();
  const name = templates.validateTemplateName(store, "Founders House Style");
  assert.strictEqual(name.ok, true);
  store = templates.saveTemplate(store, templates.createTemplate(name.name, docA, "tpl-house"));

  // Listing + selecting.
  assert.strictEqual(templates.listTemplates(store)[0].name, "Founders House Style");
  const selected = templates.getTemplate(store, "tpl-house");
  assert.ok(selected);

  // Applying to a brand-new episode keeps the look and uses the new cast.
  const showC = episodeWith("Founders Unfiltered #12", [
    { role: "Host", name: "Sam Rivera" },
    { role: "Guest 1", name: "Aria Lopez" },
  ]);
  const adapted = editor.applyToEpisode(templates.applyTemplate(selected), showC, { layout: selected.canvas.layoutId });
  assert.strictEqual(adapted.presetName, "Bold Broadcast");
  assert.strictEqual(adapted.titleText, "Founders House Style");
  assert.deepStrictEqual(adapted.speakerFrames.map((f) => f.name), ["Sam Rivera", "Aria Lopez"]);
});

console.log(`\nshow templates: ${passed} assertions passed`);
