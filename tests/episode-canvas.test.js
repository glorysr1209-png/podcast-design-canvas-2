"use strict";

// Reusable canvas editor smoke suite for Podcast Design Canvas (#11).
// Guards the documented acceptance: open the canvas editor from a chosen style, change at
// least one layout element, save the design as a named reusable show template, and reselect
// that template for future episode use. Run with: `node tests/episode-canvas.test.js`.

const assert = require("assert");
const canvas = require("../app/episode-canvas.js");
const style = require("../app/episode-style.js");
const setup = require("../app/episode-setup.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

function sampleSpeakers() {
  return [
    { role: "Host", name: "Sam Rivera" },
    { role: "Guest 1", name: "Dana Kim" },
  ];
}

function sampleStyle() {
  return style.summarizeStyle({ presetId: "split-stage", layout: "split", pacing: "balanced" }, 2);
}

test("opening the canvas seeds frames per speaker plus title, captions, background, overlay", () => {
  const layout = canvas.openLayout({
    style: sampleStyle(),
    speakers: sampleSpeakers(),
    episodeName: "Founders Unfiltered #7",
  });
  const frames = layout.elements.filter((e) => e.type === "frame");
  assert.strictEqual(frames.length, 2, "one frame per speaker");
  assert.deepStrictEqual(frames.map((f) => f.name), ["Sam Rivera", "Dana Kim"]);
  // Every customizable layer the issue calls out is present.
  ["background", "title", "caption", "overlay"].forEach((type) => {
    assert.ok(layout.elements.some((e) => e.type === type), `${type} element exists`);
  });
  // The canvas opens already looking like the chosen preset, not a blank workspace.
  assert.strictEqual(layout.presetName, "Split Stage");
  assert.strictEqual(canvas.findElement(layout, "background").color, sampleStyle().background);
  assert.strictEqual(canvas.findElement(layout, "title").text, "Founders Unfiltered #7");
});

test("background is drawn behind and the overlay starts hidden (no overproduction)", () => {
  const layout = canvas.openLayout({ style: sampleStyle(), speakers: sampleSpeakers() });
  assert.strictEqual(layout.elements[0].type, "background", "background is the back layer");
  assert.strictEqual(canvas.findElement(layout, "overlay").visible, false);
  assert.strictEqual(canvas.findElement(layout, "title").text, "Episode title", "falls back to a default title");
});

test("changing a layout element produces a new, edited layout", () => {
  const layout = canvas.openLayout({ style: sampleStyle(), speakers: sampleSpeakers() });

  const titled = canvas.setTitleText(layout, "  The Build Hour  ");
  assert.strictEqual(canvas.findElement(titled, "title").text, "The Build Hour");
  assert.strictEqual(canvas.findElement(layout, "title").text, "Episode title", "original layout is untouched");

  const withOverlay = canvas.toggleElement(titled, "overlay");
  assert.strictEqual(canvas.findElement(withOverlay, "overlay").visible, true);

  const recolored = canvas.setBackgroundColor(withOverlay, "#222244");
  assert.strictEqual(canvas.findElement(recolored, "background").color, "#222244");

  const hiddenCaption = canvas.toggleElement(recolored, "caption");
  assert.strictEqual(canvas.findElement(hiddenCaption, "caption").visible, false);
  assert.ok(
    canvas.visibleElements(hiddenCaption).every((e) => e.id !== "caption"),
    "hidden caption drops out of the visible set",
  );
});

test("an empty template name is rejected with a creator-facing message", () => {
  const store = canvas.createStore();
  const check = canvas.validateTemplateName(store, "   ");
  assert.strictEqual(check.ok, false);
  assert.ok(check.message.length > 0);
  assert.throws(() => canvas.saveTemplate(store, "", { elements: [] }), /Name your show template/);
});

test("saving a design stores a named reusable template that can be reselected", () => {
  const store = canvas.createStore();
  const layout = canvas.setTitleText(
    canvas.toggleElement(canvas.openLayout({ style: sampleStyle(), speakers: sampleSpeakers() }), "overlay"),
    "Signature Show Look",
  );

  const saved = canvas.saveTemplate(store, "Signature Show Look", layout);
  assert.ok(saved.id, "the template has an id");
  assert.strictEqual(saved.name, "Signature Show Look");
  assert.strictEqual(canvas.listTemplates(store).length, 1);

  // Reselect it later: the saved customizations survive the round trip.
  const reselected = canvas.getTemplate(store, saved.id);
  assert.ok(reselected, "the saved template is available for future use");
  assert.strictEqual(canvas.findElement(reselected.layout, "title").text, "Signature Show Look");
  assert.strictEqual(canvas.findElement(reselected.layout, "overlay").visible, true);
});

test("duplicate template names are rejected so the library stays clear", () => {
  const store = canvas.createStore();
  const layout = canvas.openLayout({ style: sampleStyle(), speakers: sampleSpeakers() });
  canvas.saveTemplate(store, "My Show", layout);
  assert.strictEqual(canvas.validateTemplateName(store, "my show").ok, false, "case-insensitive collision");
  assert.throws(() => canvas.saveTemplate(store, "My Show", layout), /already have a template/);
});

test("a saved template keeps the identity but adapts to a new episode's speakers", () => {
  const store = canvas.createStore();
  const layout = canvas.setBackgroundColor(
    canvas.toggleElement(canvas.openLayout({ style: sampleStyle(), speakers: sampleSpeakers() }), "overlay"),
    "#101035",
  );
  const saved = canvas.saveTemplate(store, "House Style", layout);

  const newSpeakers = [
    { role: "Host", name: "Sam Rivera" },
    { role: "Guest 1", name: "Priya Patel" },
    { role: "Guest 2", name: "Marco Vidal" },
  ];
  const applied = canvas.applyTemplate(saved, newSpeakers);
  const frames = applied.elements.filter((e) => e.type === "frame");
  assert.deepStrictEqual(frames.map((f) => f.name), ["Sam Rivera", "Priya Patel", "Marco Vidal"]);
  // The reusable identity carries over to the new episode.
  assert.strictEqual(canvas.findElement(applied, "background").color, "#101035");
  assert.strictEqual(canvas.findElement(applied, "overlay").visible, true);
  assert.strictEqual(applied.elements[0].type, "background", "stacking order is preserved");
});

test("a store rehydrated from serialized templates keeps ids unique", () => {
  const store = canvas.createStore();
  const layout = canvas.openLayout({ style: sampleStyle(), speakers: sampleSpeakers() });
  const first = canvas.saveTemplate(store, "One", layout);

  // Simulate a reload: serialize and rebuild the store from stored templates only.
  const rehydrated = canvas.createStore({ templates: JSON.parse(JSON.stringify(canvas.listTemplates(store))) });
  const second = canvas.saveTemplate(rehydrated, "Two", layout);
  assert.notStrictEqual(first.id, second.id, "ids do not collide after a reload");
  assert.strictEqual(canvas.listTemplates(rehydrated).length, 2);
});

// End-to-end: a completed setup feeds the style step, the style opens the canvas editor, the
// creator changes an element and saves a reusable template, then reselects it — the runnable
// check for issue #11.
test("ACCEPTANCE: setup → style → open canvas → edit → save template → reselect", () => {
  const draft = setup.createDraft();
  draft.episodeName = "Founders Unfiltered #7";
  draft.sourceMode = "upload";
  draft.speakers = [
    Object.assign(setup.createSpeaker("Host"), { name: "Sam Rivera", fileName: "sam.mp4" }),
    Object.assign(setup.createSpeaker("Guest 1"), { name: "Dana Kim", fileName: "dana.mp4" }),
  ];
  assert.strictEqual(setup.validateDraft(draft).ok, true);

  const episode = setup.summarize(draft);
  const selection = style.applyPresetToSelection(style.createSelection(), "panel-grid", false);
  const applied = style.summarizeStyle(selection, episode.speakerCount);

  // Open the canvas editor from the chosen style.
  let layout = canvas.openLayout({ style: applied, speakers: episode.speakers, episodeName: episode.episodeName });
  assert.strictEqual(layout.presetName, "Panel Grid");
  assert.strictEqual(layout.elements.filter((e) => e.type === "frame").length, 2);

  // Visibly customize at least one element without editing code.
  layout = canvas.setTitleText(layout, "Founders Unfiltered");
  layout = canvas.toggleElement(layout, "overlay");

  // Save the design as a named reusable show template, then reselect it.
  const store = canvas.createStore();
  const template = canvas.saveTemplate(store, "Founders House Style", layout);
  const reselected = canvas.getTemplate(store, template.id);
  assert.ok(reselected, "saved template is available for the next episode");
  assert.strictEqual(canvas.findElement(reselected.layout, "title").text, "Founders Unfiltered");
  assert.strictEqual(canvas.findElement(reselected.layout, "overlay").visible, true);
});

console.log(`\nepisode canvas: ${passed} assertions passed`);
