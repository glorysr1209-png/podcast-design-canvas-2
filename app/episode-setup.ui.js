"use strict";

// Browser wiring for the episode setup flow (#1) and the preset style step (#4). Renders
// the setup wizard, the episode workspace, and the preset style selection + preview from
// the shared PdcEpisodeSetup / PdcEpisodeStyle rules. Loaded as a classic script so the
// app runs by opening index.html directly or via `npm run preview`.
(function () {
  const ES = window.PdcEpisodeSetup;
  const STY = window.PdcEpisodeStyle;
  const CV = window.PdcEpisodeCanvas;
  const root = document.getElementById("app");
  const stepPill = document.querySelector(".step-pill");
  if (!ES || !root) {
    return;
  }

  let state = ES.createDraft();
  let errors = {};
  let showErrors = false;
  // Style step state, kept across navigation so choices survive Edit setup / Back.
  let styleSelection = STY ? STY.createSelection() : null;
  let appliedStyle = null;
  let layoutCustomized = false;
  // Canvas editor state (#11): the working layout, a status line, and the reusable show
  // template library. Templates persist to localStorage so they are available next episode.
  let canvasLayout = null;
  let canvasMessage = null;
  let canvasDraftName = "";
  const TEMPLATE_KEY = "pdc.showTemplates.v1";
  let templateStore = loadTemplates();

  function loadTemplates() {
    if (!CV) {
      return null;
    }
    try {
      const raw = window.localStorage ? window.localStorage.getItem(TEMPLATE_KEY) : null;
      const parsed = raw ? JSON.parse(raw) : null;
      return CV.createStore(parsed && typeof parsed === "object" ? parsed : {});
    } catch (err) {
      return CV.createStore({});
    }
  }

  function persistTemplates() {
    if (!CV || !templateStore) {
      return;
    }
    try {
      if (window.localStorage) {
        window.localStorage.setItem(
          TEMPLATE_KEY,
          JSON.stringify({ seq: templateStore.seq, templates: templateStore.templates }),
        );
      }
    } catch (err) {
      // Persistence is best-effort; the editor still works in-session without storage.
    }
  }

  function setStep(label) {
    if (stepPill) {
      stepPill.textContent = label;
    }
  }

  // Tiny DOM helper: el("div", {class:"x", onclick:fn}, child, child...).
  function el(tag, attrs) {
    const node = document.createElement(tag);
    const props = attrs || {};
    Object.keys(props).forEach((key) => {
      const value = props[key];
      if (value == null || value === false) {
        return;
      }
      if (key === "class") {
        node.className = value;
      } else if (key === "for") {
        node.htmlFor = value;
      } else if (key.indexOf("on") === 0 && typeof value === "function") {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (value === true) {
        node.setAttribute(key, "");
      } else {
        node.setAttribute(key, value);
      }
    });
    for (let i = 2; i < arguments.length; i += 1) {
      appendChild(node, arguments[i]);
    }
    return node;
  }

  function appendChild(node, child) {
    if (child == null || child === false) {
      return;
    }
    if (Array.isArray(child)) {
      child.forEach((c) => appendChild(node, c));
    } else if (typeof child === "string") {
      node.appendChild(document.createTextNode(child));
    } else {
      node.appendChild(child);
    }
  }

  function fieldId(key) {
    if (key.indexOf("speaker:") === 0) {
      const parts = key.split(":");
      return parts.length === 4
        ? `f-sp-${parts[1]}-social-${parts[3]}`
        : `f-sp-${parts[1]}-${parts[2]}`;
    }
    return `f-${key}`;
  }

  // Inline error paragraph for a field, shown only after a failed Continue.
  function errorFor(key) {
    if (!showErrors || !errors[key]) {
      return null;
    }
    return el("p", { class: "field-error", role: "alert" }, errors[key]);
  }

  function isInvalid(key) {
    return showErrors && Boolean(errors[key]);
  }

  function field(labelText, control, key, hint) {
    return el(
      "div",
      { class: "field" },
      el("label", { for: control.id }, labelText),
      hint ? el("p", { class: "hint" }, hint) : null,
      control,
      key ? errorFor(key) : null,
    );
  }

  function nextRole() {
    const used = {};
    state.speakers.forEach((s) => {
      used[s.role] = true;
    });
    const free = ES.SPEAKER_BUCKETS.find((bucket) => !used[bucket]);
    return free || `Guest ${state.speakers.length}`;
  }

  // ---- Setup view -------------------------------------------------------------

  function renderSetup() {
    root.innerHTML = "";
    setStep("Step 1 of 6 · Set up episode");
    state.sourceMode = ES.normalizeMode(state.sourceMode);

    const form = el("form", { class: "setup", novalidate: true });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      onContinue();
    });

    if (showErrors && errors && Object.keys(errors).length) {
      form.appendChild(
        el(
          "div",
          { class: "banner", role: "alert", tabindex: "-1", id: "error-banner" },
          el("strong", {}, "A few things need a quick fix:"),
          el(
            "ul",
            {},
            // Show up to the first handful of messages so the banner stays scannable.
            (function () {
              const seen = {};
              const items = [];
              Object.keys(errors).forEach((k) => {
                const msg = errors[k];
                if (!seen[msg]) {
                  seen[msg] = true;
                  items.push(el("li", {}, msg));
                }
              });
              return items;
            })(),
          ),
        ),
      );
    }

    // Episode details
    const nameInput = el("input", {
      id: "f-episodeName",
      type: "text",
      value: state.episodeName,
      placeholder: "e.g. Episode 12 — Building in Public",
      "aria-invalid": isInvalid("episodeName") ? "true" : null,
    });
    nameInput.addEventListener("input", (e) => {
      state.episodeName = e.target.value;
    });

    const detailsCard = el(
      "section",
      { class: "card" },
      el("h2", {}, "Episode details"),
      field("Episode name", nameInput, "episodeName"),
    );
    form.appendChild(detailsCard);

    // Recording source
    const modeButtons = ES.SOURCE_MODES.map((mode) => {
      const id = `mode-${mode.key}`;
      const input = el("input", {
        id,
        type: "radio",
        name: "sourceMode",
        value: mode.key,
        checked: state.sourceMode === mode.key,
      });
      input.addEventListener("change", () => {
        state.sourceMode = mode.key;
        renderSetup();
      });
      return el("label", { class: "mode-option", for: id }, input, el("span", {}, mode.label));
    });

    const sourceCard = el(
      "section",
      { class: "card" },
      el("h2", {}, "Recording source"),
      el("p", { class: "hint" }, "Bring in your recording, then assign each track to a speaker below."),
      el("div", { class: "mode-row" }, modeButtons),
    );

    if (state.sourceMode === "riverside") {
      const linkInput = el("input", {
        id: "f-riversideLink",
        type: "url",
        value: state.riversideLink,
        placeholder: "https://riverside.fm/studio/your-episode",
        "aria-invalid": isInvalid("riversideLink") ? "true" : null,
      });
      linkInput.addEventListener("input", (e) => {
        state.riversideLink = e.target.value;
      });
      sourceCard.appendChild(
        field("Riverside recording link", linkInput, "riversideLink", "Paste the link to your Riverside recording session."),
      );
    } else {
      sourceCard.appendChild(
        el("p", { class: "hint" }, "Add a separate synced video file for each speaker in the cards below."),
      );
    }
    form.appendChild(sourceCard);

    // Speakers & sources
    const speakersCard = el("section", { class: "card" }, el("h2", {}, "Speakers & sources"));
    state.speakers.forEach((speaker, index) => {
      speakersCard.appendChild(renderSpeaker(speaker, index));
    });

    const addButton = el("button", { type: "button", class: "ghost" }, "+ Add speaker source");
    addButton.addEventListener("click", () => {
      state.speakers.push(ES.createSpeaker(nextRole()));
      renderSetup();
    });
    speakersCard.appendChild(addButton);
    form.appendChild(speakersCard);

    form.appendChild(
      el(
        "div",
        { class: "actions" },
        el("button", { type: "submit", class: "primary" }, "Continue to style →"),
      ),
    );

    root.appendChild(form);

    if (showErrors) {
      focusFirstError();
    }
  }

  function renderSpeaker(speaker, index) {
    const card = el("div", { class: "speaker" });
    const header = el(
      "div",
      { class: "speaker-head" },
      el("span", { class: "speaker-tag" }, `Source ${index + 1}`),
    );
    const removeButton = el("button", {
      type: "button",
      class: "link-button",
      "aria-label": `Remove source ${index + 1}`,
      disabled: state.speakers.length <= 1 ? true : null,
    }, "Remove");
    removeButton.addEventListener("click", () => {
      if (state.speakers.length > 1) {
        state.speakers.splice(index, 1);
        renderSetup();
      }
    });
    header.appendChild(removeButton);
    card.appendChild(header);

    // Name
    const nameInput = el("input", {
      id: `f-sp-${index}-name`,
      type: "text",
      value: speaker.name,
      placeholder: "Speaker name",
      "aria-invalid": isInvalid(`speaker:${index}:name`) ? "true" : null,
    });
    nameInput.addEventListener("input", (e) => {
      speaker.name = e.target.value;
    });
    card.appendChild(field("Speaker name", nameInput, `speaker:${index}:name`));

    // Role bucket
    const roleSelect = el("select", {
      id: `f-sp-${index}-role`,
      "aria-invalid": isInvalid(`speaker:${index}:role`) ? "true" : null,
    });
    ES.SPEAKER_BUCKETS.forEach((bucket) => {
      const option = el("option", { value: bucket, selected: speaker.role === bucket ? true : null }, bucket);
      roleSelect.appendChild(option);
    });
    roleSelect.addEventListener("change", (e) => {
      speaker.role = e.target.value;
    });
    card.appendChild(field("Role", roleSelect, `speaker:${index}:role`));

    // Source: file (upload) or optional channel label (riverside)
    if (state.sourceMode === "upload") {
      const fileInput = el("input", {
        id: `f-sp-${index}-source`,
        type: "file",
        accept: "video/*",
        "aria-invalid": isInvalid(`speaker:${index}:source`) ? "true" : null,
      });
      const chosen = el(
        "p",
        { class: "chosen-file" },
        speaker.fileName ? `Selected: ${speaker.fileName}` : "No file chosen yet",
      );
      fileInput.addEventListener("change", (e) => {
        const file = e.target.files && e.target.files[0];
        speaker.fileName = file ? file.name : "";
        speaker.fileSize = file ? file.size : 0;
        chosen.textContent = speaker.fileName ? `Selected: ${speaker.fileName}` : "No file chosen yet";
      });
      card.appendChild(field("Speaker video file", fileInput, `speaker:${index}:source`));
      card.appendChild(chosen);
    } else {
      const trackInput = el("input", {
        id: `f-sp-${index}-source`,
        type: "text",
        value: speaker.trackLabel,
        placeholder: "e.g. Track 1 (optional)",
      });
      trackInput.addEventListener("input", (e) => {
        speaker.trackLabel = e.target.value;
      });
      card.appendChild(field("Channel label", trackInput, null, "Optional — name this speaker's channel in the recording."));
    }

    // Optional social links
    const social = el("details", { class: "social" });
    social.appendChild(el("summary", {}, "Social links (optional)"));
    const socialHint = el(
      "p",
      { class: "hint" },
      "Used only to spell names right and add relevant context — never to surface personal details.",
    );
    social.appendChild(socialHint);
    ES.SOCIAL_NETWORKS.forEach((net) => {
      const input = el("input", {
        id: `f-sp-${index}-social-${net.key}`,
        type: "url",
        value: speaker.social[net.key] || "",
        placeholder: `${net.label} URL`,
        "aria-invalid": isInvalid(`speaker:${index}:social:${net.key}`) ? "true" : null,
      });
      input.addEventListener("input", (e) => {
        speaker.social[net.key] = e.target.value;
      });
      social.appendChild(field(net.label, input, `speaker:${index}:social:${net.key}`));
    });
    card.appendChild(social);

    return card;
  }

  function onContinue() {
    const result = ES.validateDraft(state);
    errors = result.errors;
    showErrors = true;
    if (result.ok) {
      const summary = ES.summarize(state);
      if (STY && !appliedStyle) {
        renderStyle(summary);
      } else {
        renderWorkspace(summary);
      }
    } else {
      renderSetup();
    }
  }

  function focusFirstError() {
    const keys = Object.keys(errors);
    if (!keys.length) {
      return;
    }
    const banner = document.getElementById("error-banner");
    if (banner) {
      banner.focus();
    }
    const target = document.getElementById(fieldId(keys[0]));
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ block: "center" });
    }
  }

  // ---- Workspace summary view -------------------------------------------------

  function renderWorkspace(summary) {
    root.innerHTML = "";
    setStep("Step 1 of 6 · Episode workspace");

    const view = el("div", { class: "workspace" });
    view.appendChild(
      el(
        "div",
        { class: "workspace-head" },
        el("p", { class: "eyebrow" }, "Episode workspace"),
        el("h2", {}, summary.episodeName),
      ),
    );

    // Captured context
    const context = el(
      "section",
      { class: "card" },
      el("h3", {}, "Captured context"),
      el(
        "div",
        { class: "stats" },
        stat(summary.sourceModeLabel, "Source"),
        stat(String(summary.speakerCount), `Speaker${summary.speakerCount === 1 ? "" : "s"}`),
        stat(String(summary.socialLinkCount), `Social link${summary.socialLinkCount === 1 ? "" : "s"}`),
      ),
    );
    if (summary.riversideLink) {
      context.appendChild(
        el(
          "p",
          { class: "context-link" },
          "Recording: ",
          el("a", { href: summary.riversideLink, target: "_blank", rel: "noopener noreferrer" }, summary.riversideLink),
        ),
      );
    }
    view.appendChild(context);

    // Sources & speakers
    const sources = el("section", { class: "card" }, el("h3", {}, "Sources & speakers"));
    summary.speakers.forEach((speaker) => {
      const row = el(
        "div",
        { class: "summary-speaker" },
        el(
          "div",
          { class: "summary-speaker-main" },
          el("span", { class: "role-pill" }, speaker.role || "Unassigned"),
          el("span", { class: "summary-name" }, speaker.name || "Unnamed speaker"),
        ),
        el("p", { class: "summary-source" }, speaker.sourceLabel),
      );
      if (speaker.social.length) {
        const chips = el("div", { class: "chips" });
        speaker.social.forEach((link) => {
          chips.appendChild(
            el("a", { class: "chip", href: link.url, target: "_blank", rel: "noopener noreferrer" }, link.label),
          );
        });
        row.appendChild(chips);
      }
      sources.appendChild(row);
    });
    view.appendChild(sources);

    // Selected style (shown once a preset has been applied to the episode)
    if (STY && appliedStyle) {
      const styleCard = el(
        "section",
        { class: "card selected-style" },
        el("h3", {}, "Selected style"),
        el(
          "div",
          { class: "selected-style-body" },
          renderPreview(summary, styleSelection, true),
          el(
            "div",
            { class: "selected-style-meta" },
            el("p", { class: "selected-style-name" }, appliedStyle.presetName),
            el("p", { class: "hint" }, appliedStyle.tagline),
            el(
              "p",
              { class: "selected-style-facts" },
              `Layout: ${appliedStyle.layoutLabel} · Pacing: ${appliedStyle.pacingLabel} · Captions: ${appliedStyle.captionStyle}`,
            ),
          ),
        ),
      );
      view.appendChild(styleCard);
    }

    // Next step — choose a style, then customize it in the canvas editor.
    const styleAvailable = Boolean(STY);
    const canvasAvailable = Boolean(CV) && Boolean(appliedStyle);

    // Once a style is applied, opening the canvas editor is the primary next action.
    const editorButton = el("button", { type: "button", class: "primary" }, "Open canvas editor →");
    editorButton.addEventListener("click", () => {
      canvasMessage = null;
      renderCanvasEditor(summary);
    });

    const styleButton = el(
      "button",
      {
        type: "button",
        class: canvasAvailable ? "ghost" : "primary",
        disabled: styleAvailable ? null : true,
      },
      appliedStyle ? "Change style →" : "Choose a style →",
    );
    if (styleAvailable) {
      styleButton.addEventListener("click", () => renderStyle(summary));
    }

    const templateCount = CV && templateStore ? CV.listTemplates(templateStore).length : 0;
    view.appendChild(
      el(
        "section",
        { class: "card next-step" },
        el("h3", {}, appliedStyle ? "Style applied" : "Ready for the next step"),
        el(
          "p",
          {},
          appliedStyle
            ? "Your style is set. Open the canvas editor to customize the layout and save it as a reusable show template."
            : "Your sources, speaker roles, and context are saved. Pick a visual style next.",
        ),
        templateCount
          ? el(
              "p",
              { class: "hint" },
              `${templateCount} saved show template${templateCount === 1 ? "" : "s"} available for this and future episodes.`,
            )
          : null,
        el(
          "div",
          { class: "actions" },
          canvasAvailable ? editorButton : null,
          styleButton,
          (function () {
            const back = el("button", { type: "button", class: "ghost" }, "← Edit setup");
            back.addEventListener("click", () => {
              showErrors = false;
              renderSetup();
            });
            return back;
          })(),
        ),
      ),
    );

    root.appendChild(view);
    view.scrollIntoView({ block: "start" });
  }

  // ---- Preset style selection + preview (#4) ----------------------------------

  // A live preview built from the real assigned speakers. `compact` renders the smaller
  // version shown on the workspace once a style is applied.
  function renderPreview(summary, selection, compact) {
    const preset = STY.getPreset(selection && selection.presetId);
    const pacing = STY.getPacing(selection && selection.pacing);
    const frames = STY.buildPreviewFrames(summary.speakers, selection, summary.speakerCount);
    const layoutId = STY.resolveLayout(selection, summary.speakerCount);

    const stage = el("div", {
      class: `preview-stage stage-${layoutId} pacing-${pacing.id}${compact ? " compact" : ""}`,
    });
    stage.style.background = preset.background;
    stage.style.color = preset.textColor;

    const frameWrap = el("div", { class: "preview-frames" });
    frames.forEach((frame) => {
      const frameEl = el(
        "div",
        { class: `preview-frame${frame.active ? " active" : ""}` },
        el("span", { class: "preview-role" }, frame.role),
        el("span", { class: "preview-name" }, frame.name),
      );
      frameEl.style.borderColor = preset.accent;
      if (frame.active) {
        frameEl.style.boxShadow = `0 0 0 2px ${preset.accent}`;
      }
      frameWrap.appendChild(frameEl);
    });
    stage.appendChild(frameWrap);

    // Sample caption strip so the caption treatment is visible in the preview.
    const caption = el(
      "div",
      { class: "preview-caption" },
      el("span", { class: "preview-caption-text" }, "Sample caption — this is how on-screen text will look."),
    );
    caption.style.background = preset.accent;
    stage.appendChild(caption);

    if (!compact) {
      const foot = el(
        "p",
        { class: "preview-foot" },
        `${pacing.label} pacing · ${preset.captionStyle} · ${STY.getLayout(layoutId).label}`,
      );
      const container = el("div", {}, stage, foot);
      return container;
    }
    return stage;
  }

  function renderStyle(summary) {
    root.innerHTML = "";
    setStep("Step 2 of 6 · Choose a style");
    if (!styleSelection) {
      styleSelection = STY.createSelection();
    }

    const view = el("div", { class: "style-step" });
    view.appendChild(
      el(
        "div",
        { class: "workspace-head" },
        el("p", { class: "eyebrow" }, "Choose a style"),
        el("h2", {}, `Pick a look for ${summary.episodeName}`),
        el("p", { class: "hint" }, "Start from a preset, then fine-tune layout and pacing. The preview uses your real speakers."),
      ),
    );

    const layoutGrid = el("div", { class: "style-layout" });

    // Controls column
    const controls = el("section", { class: "card" }, el("h3", {}, "Style presets"));
    const presetGrid = el("div", { class: "preset-grid" });
    STY.STYLE_PRESETS.forEach((preset) => {
      const selected = styleSelection.presetId === preset.id;
      const card = el(
        "button",
        {
          type: "button",
          class: `preset-card${selected ? " selected" : ""}`,
          "aria-pressed": selected ? "true" : "false",
        },
        (function () {
          const swatch = el("span", { class: "preset-swatch" });
          swatch.style.background = preset.background;
          swatch.style.borderColor = preset.accent;
          const dot = el("span", { class: "preset-swatch-dot" });
          dot.style.background = preset.accent;
          swatch.appendChild(dot);
          return swatch;
        })(),
        el("span", { class: "preset-name" }, preset.name),
        el("span", { class: "preset-tagline" }, preset.tagline),
      );
      card.addEventListener("click", () => {
        styleSelection = STY.applyPresetToSelection(styleSelection, preset.id, layoutCustomized);
        renderStyle(summary);
      });
      presetGrid.appendChild(card);
    });
    controls.appendChild(presetGrid);

    // Layout control
    const layoutSelect = el("select", { id: "style-layout" });
    STY.LAYOUTS.forEach((layout) => {
      layoutSelect.appendChild(
        el("option", { value: layout.id, selected: styleSelection.layout === layout.id ? true : null }, layout.label),
      );
    });
    layoutSelect.addEventListener("change", (e) => {
      styleSelection.layout = e.target.value;
      layoutCustomized = styleSelection.layout !== "auto";
      renderStyle(summary);
    });
    controls.appendChild(field("Layout", layoutSelect, null, "Auto matches the number of speakers you set up."));

    // Pacing control
    const pacingSelect = el("select", { id: "style-pacing" });
    STY.PACING.forEach((pacing) => {
      pacingSelect.appendChild(
        el("option", { value: pacing.id, selected: styleSelection.pacing === pacing.id ? true : null }, pacing.label),
      );
    });
    pacingSelect.addEventListener("change", (e) => {
      styleSelection.pacing = e.target.value;
      renderStyle(summary);
    });
    controls.appendChild(field("Pacing", pacingSelect, null, STY.getPacing(styleSelection.pacing).note));

    layoutGrid.appendChild(controls);

    // Preview column
    const previewCard = el(
      "section",
      { class: "card preview-card" },
      el("h3", {}, "Preview"),
      renderPreview(summary, styleSelection, false),
    );
    layoutGrid.appendChild(previewCard);

    view.appendChild(layoutGrid);

    // Actions
    const applyButton = el("button", { type: "button", class: "primary" }, "Apply style & continue →");
    applyButton.addEventListener("click", () => {
      appliedStyle = STY.summarizeStyle(styleSelection, summary.speakerCount);
      renderWorkspace(summary);
    });
    const back = el("button", { type: "button", class: "ghost" }, "← Back to workspace");
    back.addEventListener("click", () => renderWorkspace(summary));
    view.appendChild(el("div", { class: "actions" }, applyButton, back));

    root.appendChild(view);
    view.scrollIntoView({ block: "start" });
  }

  // ---- Reusable canvas editor (#11) -------------------------------------------

  function templateLayoutLabel(layoutId) {
    if (STY && layoutId) {
      return STY.getLayout(layoutId).label;
    }
    return "Custom layout";
  }

  // A live canvas preview built from the current editable layout. `refs.titleNode` is
  // captured so the title can update live as the creator types without a full re-render.
  function renderCanvasPreview(layout, refs) {
    const bg = CV.findElement(layout, "background");
    const title = CV.findElement(layout, "title");
    const caption = CV.findElement(layout, "caption");
    const overlay = CV.findElement(layout, "overlay");
    const frames = layout.elements.filter((e) => e.type === "frame" && e.visible);
    const accent = layout.accent || "#ffb347";

    const stage = el("div", { class: "canvas-stage" });
    stage.style.background = (bg && bg.color) || "#10131f";
    stage.style.borderColor = accent;

    if (title && title.visible) {
      const titleNode = el("div", { class: "canvas-title" }, title.text || "Episode title");
      titleNode.style.color = accent;
      refs.titleNode = titleNode;
      stage.appendChild(titleNode);
    }

    const frameWrap = el("div", { class: "canvas-frames" });
    if (frames.length) {
      frames.forEach((frame) => {
        const frameEl = el(
          "div",
          { class: "canvas-frame" },
          el("span", { class: "preview-role" }, frame.role),
          el("span", { class: "preview-name" }, frame.name),
        );
        frameEl.style.borderColor = accent;
        frameWrap.appendChild(frameEl);
      });
    } else {
      frameWrap.appendChild(el("p", { class: "canvas-empty" }, "All speaker frames are hidden."));
    }
    stage.appendChild(frameWrap);

    if (overlay && overlay.visible) {
      const overlayEl = el("div", { class: "canvas-overlay" }, "Overlay / b-roll area");
      overlayEl.style.borderColor = accent;
      stage.appendChild(overlayEl);
    }

    if (caption && caption.visible) {
      const captionEl = el("div", { class: "canvas-caption" }, `Sample caption · ${caption.captionStyle}`);
      captionEl.style.background = accent;
      stage.appendChild(captionEl);
    }
    return stage;
  }

  function seedCanvasLayout(summary) {
    const needsSeed = !canvasLayout || (appliedStyle && canvasLayout.presetId !== appliedStyle.presetId);
    if (needsSeed) {
      canvasLayout = CV.openLayout({
        style: appliedStyle,
        speakers: summary.speakers,
        episodeName: summary.episodeName,
      });
    }
  }

  function renderCanvasEditor(summary) {
    root.innerHTML = "";
    setStep("Step 3 of 6 · Customize canvas");
    seedCanvasLayout(summary);

    const view = el("div", { class: "canvas-step" });
    view.appendChild(
      el(
        "div",
        { class: "workspace-head" },
        el("p", { class: "eyebrow" }, "Customize canvas"),
        el("h2", {}, `Customize ${appliedStyle.presetName} for ${summary.episodeName}`),
        el(
          "p",
          { class: "hint" },
          "Adjust each layout element by hand, then save the look as a reusable show template. The preview uses your real speakers.",
        ),
      ),
    );

    const grid = el("div", { class: "style-layout" });

    // Live title node, captured so typing updates the preview without a full re-render.
    const refs = {};
    const stage = renderCanvasPreview(canvasLayout, refs);

    // --- Left column: editable layout elements ---
    const elementsCard = el(
      "section",
      { class: "card" },
      el("h3", {}, "Layout elements"),
      el("p", { class: "hint" }, "Show, hide, and adjust each layer. Changes preview live on the right."),
    );

    function visibilityToggle(element) {
      const id = `cv-vis-${element.id}`;
      const input = el("input", { id, type: "checkbox", checked: element.visible ? true : null });
      input.addEventListener("change", () => {
        canvasLayout = CV.toggleElement(canvasLayout, element.id);
        canvasMessage = null;
        renderCanvasEditor(summary);
      });
      return el("label", { class: "cv-toggle", for: id }, input, el("span", {}, element.visible ? "Visible" : "Hidden"));
    }

    canvasLayout.elements.forEach((element) => {
      const head = el(
        "div",
        { class: "cv-element-head" },
        el("span", { class: "cv-element-label" }, element.label),
        element.id === "background" ? null : visibilityToggle(element),
      );
      const row = el("div", { class: "cv-element" }, head);

      if (element.type === "background") {
        const swatches = el("div", { class: "cv-swatches" });
        const palette = [];
        if (STY) {
          STY.STYLE_PRESETS.forEach((preset) => {
            if (palette.indexOf(preset.background) < 0) {
              palette.push(preset.background);
            }
          });
        }
        if (palette.indexOf(element.color) < 0) {
          palette.unshift(element.color);
        }
        palette.forEach((color) => {
          const selected = color === element.color;
          const swatch = el("button", {
            type: "button",
            class: `cv-swatch${selected ? " selected" : ""}`,
            "aria-pressed": selected ? "true" : "false",
            "aria-label": `Use background ${color}`,
          });
          swatch.style.background = color;
          swatch.addEventListener("click", () => {
            canvasLayout = CV.setBackgroundColor(canvasLayout, color);
            canvasMessage = null;
            renderCanvasEditor(summary);
          });
          swatches.appendChild(swatch);
        });
        row.appendChild(swatches);
      } else if (element.type === "title") {
        const titleInput = el("input", {
          id: "cv-title",
          type: "text",
          value: element.text,
          placeholder: "Episode title",
        });
        titleInput.addEventListener("input", (e) => {
          canvasLayout = CV.setTitleText(canvasLayout, e.target.value);
          if (refs.titleNode) {
            refs.titleNode.textContent = e.target.value.trim() || "Episode title";
          }
        });
        row.appendChild(titleInput);
      } else if (element.type === "caption") {
        row.appendChild(el("p", { class: "hint" }, `Caption style: ${element.captionStyle}`));
      } else if (element.type === "frame") {
        row.appendChild(el("p", { class: "hint" }, element.name));
      } else if (element.type === "overlay") {
        row.appendChild(el("p", { class: "hint" }, "A space for b-roll, screenshots, or visual callouts."));
      }
      elementsCard.appendChild(row);
    });
    grid.appendChild(elementsCard);

    // --- Right column: preview + save + template library ---
    const rightCol = el("div", { class: "canvas-right" });
    rightCol.appendChild(el("section", { class: "card preview-card" }, el("h3", {}, "Canvas preview"), stage));

    // Save as reusable show template
    const saveCard = el(
      "section",
      { class: "card" },
      el("h3", {}, "Save as show template"),
      el(
        "p",
        { class: "hint" },
        "Reuse this look on future episodes — it keeps the identity and adapts to each episode's speakers.",
      ),
    );
    const nameInput = el("input", {
      id: "cv-tpl-name",
      type: "text",
      value: canvasDraftName,
      placeholder: "e.g. My Show — Signature Look",
    });
    nameInput.addEventListener("input", (e) => {
      canvasDraftName = e.target.value;
    });
    const saveButton = el("button", { type: "button", class: "primary" }, "Save template");
    saveButton.addEventListener("click", () => {
      const check = CV.validateTemplateName(templateStore, canvasDraftName);
      if (!check.ok) {
        canvasMessage = { kind: "error", text: check.message };
        renderCanvasEditor(summary);
        return;
      }
      const saved = CV.saveTemplate(templateStore, canvasDraftName, canvasLayout);
      persistTemplates();
      canvasDraftName = "";
      canvasMessage = { kind: "ok", text: `Saved “${saved.name}”. It's now available for future episodes.` };
      renderCanvasEditor(summary);
    });
    saveCard.appendChild(field("Template name", nameInput, null));
    saveCard.appendChild(el("div", { class: "actions" }, saveButton));
    if (canvasMessage) {
      saveCard.appendChild(
        el("p", { class: canvasMessage.kind === "error" ? "field-error" : "save-ok", role: "status" }, canvasMessage.text),
      );
    }
    rightCol.appendChild(saveCard);

    // Saved template library — reselect a template to reuse it on this episode.
    const templates = CV.listTemplates(templateStore);
    const libCard = el("section", { class: "card" }, el("h3", {}, "Your show templates"));
    if (!templates.length) {
      libCard.appendChild(
        el("p", { class: "hint" }, "No templates yet. Save this layout to reuse it on future episodes."),
      );
    } else {
      templates.forEach((tpl) => {
        const useButton = el("button", { type: "button", class: "ghost" }, "Use on this episode");
        useButton.addEventListener("click", () => {
          canvasLayout = CV.applyTemplate(tpl, summary.speakers);
          canvasMessage = { kind: "ok", text: `Loaded “${tpl.name}” — adapted to this episode's speakers.` };
          renderCanvasEditor(summary);
        });
        libCard.appendChild(
          el(
            "div",
            { class: "cv-template" },
            el(
              "div",
              { class: "cv-template-main" },
              el("span", { class: "summary-name" }, tpl.name),
              el("p", { class: "hint" }, `${tpl.presetName || "Custom"} · ${templateLayoutLabel(tpl.layoutId)}`),
            ),
            useButton,
          ),
        );
      });
    }
    rightCol.appendChild(libCard);

    grid.appendChild(rightCol);
    view.appendChild(grid);

    // Actions
    const back = el("button", { type: "button", class: "ghost" }, "← Back to workspace");
    back.addEventListener("click", () => renderWorkspace(summary));
    view.appendChild(el("div", { class: "actions" }, back));

    root.appendChild(view);
    view.scrollIntoView({ block: "start" });
  }

  function stat(value, label) {
    return el("div", { class: "stat" }, el("span", { class: "stat-value" }, value), el("span", { class: "stat-label" }, label));
  }

  renderSetup();
}());
