"use strict";

// Reusable podcast canvas editor model for Podcast Design Canvas (#11).
//
// This is the single source of truth for the step that follows preset selection: opening
// the chosen style as an editable layout, adjusting the visible layout elements (speaker
// frames, title, captions, background, overlay/b-roll area) by direct choice rather than
// code, and saving the result as a named, reusable show template that later episodes can
// adopt while still adapting to their own speakers. DOM-free on purpose so the same rules
// drive the screen and the tests. No build step, no dependencies.
(function (global) {
  // The layout elements a creator can see and customize. Order is the on-screen stacking
  // order from back (background) to front (overlay), matching how the editor lists them.
  const ELEMENT_TYPES = ["background", "frame", "title", "caption", "overlay"];

  function trim(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  // Build the editable speaker frames from the real assigned speaker buckets. Frames are
  // derived from setup — never invented — so the canvas always reflects the actual episode.
  function buildFrames(speakers) {
    const list = Array.isArray(speakers) ? speakers : [];
    return list.map((raw, index) => {
      const speaker = raw && typeof raw === "object" ? raw : {};
      const role = trim(speaker.role) || `Speaker ${index + 1}`;
      return {
        id: `frame-${index + 1}`,
        type: "frame",
        label: `${role} frame`,
        role,
        name: trim(speaker.name) || "Unnamed speaker",
        visible: true,
      };
    });
  }

  // The non-speaker layout elements every layout shares. Seeded from the chosen preset so a
  // creator opens the canvas already looking like their style — not a blank workspace.
  function buildFixedElements(style, episodeName) {
    const data = style && typeof style === "object" ? style : {};
    return [
      {
        id: "background",
        type: "background",
        label: "Background",
        color: data.background || "#10131f",
        visible: true,
      },
      {
        id: "title",
        type: "title",
        label: "Title",
        text: trim(episodeName) || "Episode title",
        visible: true,
      },
      {
        id: "caption",
        type: "caption",
        label: "Captions",
        captionStyle: data.captionStyle || "Clean caption bar",
        visible: true,
      },
      {
        id: "overlay",
        type: "overlay",
        label: "Overlay / b-roll area",
        // Off by default: the product avoids overproducing every moment with constant b-roll.
        visible: false,
      },
    ];
  }

  // Open a chosen style as an editable layout. `style` is a preset summary (the output of
  // PdcEpisodeStyle.summarizeStyle plus optional accent/background); `speakers` are the
  // assigned buckets. The returned layout is the editor's working document.
  function openLayout(input) {
    const data = input && typeof input === "object" ? input : {};
    const style = data.style && typeof data.style === "object" ? data.style : {};
    const frames = buildFrames(data.speakers);
    const fixed = buildFixedElements(style, data.episodeName);
    const background = fixed[0];
    const rest = fixed.slice(1);
    return {
      presetId: style.presetId || "",
      presetName: style.presetName || "",
      layoutId: style.layoutId || "auto",
      layoutLabel: style.layoutLabel || "",
      accent: style.accent || "#ffb347",
      // background first (drawn behind), then frames, then title/caption/overlay on top.
      elements: [background].concat(frames, rest),
    };
  }

  function findElement(layout, id) {
    const elements = layout && Array.isArray(layout.elements) ? layout.elements : [];
    return elements.find((element) => element.id === id) || null;
  }

  function visibleElements(layout) {
    const elements = layout && Array.isArray(layout.elements) ? layout.elements : [];
    return elements.filter((element) => element.visible);
  }

  // Immutable element edit: returns a new layout with one element patched. Keeps the editor
  // predictable (every change produces a fresh document) and easy to test.
  function updateElement(layout, id, patch) {
    const base = layout && typeof layout === "object" ? layout : { elements: [] };
    const elements = Array.isArray(base.elements) ? base.elements : [];
    return Object.assign({}, base, {
      elements: elements.map((element) =>
        element.id === id ? Object.assign({}, element, patch) : element,
      ),
    });
  }

  // Toggle a layout element's visibility — the simplest direct-manipulation edit.
  function toggleElement(layout, id) {
    const element = findElement(layout, id);
    return updateElement(layout, id, { visible: !(element && element.visible) });
  }

  function setTitleText(layout, text) {
    return updateElement(layout, "title", { text: trim(text) });
  }

  function setBackgroundColor(layout, color) {
    return updateElement(layout, "background", { color: trim(color) || "#10131f" });
  }

  // ---- Reusable show templates ------------------------------------------------

  // A store is a plain container so it can live in memory (tests) or be serialized to
  // localStorage (the browser). `seq` keeps ids stable and unique within a store.
  function createStore(initial) {
    const templates = initial && Array.isArray(initial.templates) ? clone(initial.templates) : [];
    const highest = templates.reduce((max, tpl) => {
      const n = parseInt(String(tpl && tpl.id).replace(/^tpl-/, ""), 10);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);
    return { seq: initial && typeof initial.seq === "number" ? initial.seq : highest, templates };
  }

  function validateTemplateName(store, name) {
    const text = trim(name);
    if (!text) {
      return { ok: false, message: "Name your show template so you can reuse it on future episodes." };
    }
    const existing = listTemplates(store).some(
      (tpl) => tpl.name.toLowerCase() === text.toLowerCase(),
    );
    if (existing) {
      return { ok: false, message: `You already have a template called “${text}”. Pick a different name.` };
    }
    return { ok: true, message: "" };
  }

  // Save the current layout as a named reusable template. Throws on an invalid name so the
  // UI validates first; on success the template is appended and returned.
  function saveTemplate(store, name, layout) {
    const target = store && typeof store === "object" ? store : createStore();
    const check = validateTemplateName(target, name);
    if (!check.ok) {
      throw new Error(check.message);
    }
    target.seq = (typeof target.seq === "number" ? target.seq : 0) + 1;
    const template = {
      id: `tpl-${target.seq}`,
      name: trim(name),
      presetId: (layout && layout.presetId) || "",
      presetName: (layout && layout.presetName) || "",
      layoutId: (layout && layout.layoutId) || "auto",
      layout: clone(layout && typeof layout === "object" ? layout : { elements: [] }),
    };
    if (!Array.isArray(target.templates)) {
      target.templates = [];
    }
    target.templates.push(template);
    return template;
  }

  function listTemplates(store) {
    return store && Array.isArray(store.templates) ? store.templates.slice() : [];
  }

  function getTemplate(store, id) {
    return listTemplates(store).find((tpl) => tpl.id === id) || null;
  }

  // Reuse a saved template on a (possibly different) episode: keep the saved show identity
  // — background, title, captions, overlay choices — but rebuild the speaker frames from the
  // new episode's speakers. This is the "reusable across episodes" promise from the vision.
  function applyTemplate(template, speakers) {
    const source = template && template.layout ? clone(template.layout) : { elements: [] };
    const kept = (Array.isArray(source.elements) ? source.elements : []).filter(
      (element) => element.type !== "frame",
    );
    const background = kept.filter((element) => element.type === "background");
    const onTop = kept.filter((element) => element.type !== "background");
    source.elements = background.concat(buildFrames(speakers), onTop);
    return source;
  }

  const api = {
    ELEMENT_TYPES,
    openLayout,
    findElement,
    visibleElements,
    updateElement,
    toggleElement,
    setTitleText,
    setBackgroundColor,
    createStore,
    validateTemplateName,
    saveTemplate,
    listTemplates,
    getTemplate,
    applyTemplate,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  global.PdcEpisodeCanvas = api;
}(typeof window !== "undefined" ? window : globalThis));
