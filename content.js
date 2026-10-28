/**
 * ResponsiveSnap – content script
 *
 * Opens / closes a full-screen overlay that loads the current page inside an
 * iframe, wrapped in a realistic device frame. Styling lives in content.css;
 * this file builds the DOM, owns the preview state (device, size, URL, load
 * status) and wires up the tools: presets, rotate, custom size, resize grip,
 * URL bar, reload, touch simulation, keyboard shortcuts and screenshots.
 */
(() => {
  'use strict';

  // Never run inside the preview iframe (or any other sub-frame). This is what
  // stops the overlay from recursively injecting itself into its own iframe.
  if (window !== window.top) return;

  // Guard against double injection (background.js may re-inject after an update).
  if (window.__responsiveSnapLoaded) return;
  window.__responsiveSnapLoaded = true;

  const ROOT_ID = 'responsivesnap-root';
  const FRAME_STYLE_ID = 'responsivesnap-frame-style';
  const TOGGLE_MESSAGE = 'RESPONSIVESNAP_TOGGLE';
  const FRAME_MESSAGE = 'RESPONSIVESNAP_FRAME';
  const STATE_KEY = 'rsState';
  const SAVED_KEY = 'rsSavedPresets';
  const LEGACY_KEY = 'selectedDevice'; // v1.0 stored just "mobile" | "tablet" | "desktop"
  const FIT_MARGIN = 32; // px of breathing room around a device that had to be scaled down
  const MIN_SIZE = 200;
  const MAX_SIZE = 4000;
  const SLOW_MS = 20000;

  /* ------------------------------------------------------------------ *
   *  Icons
   * ------------------------------------------------------------------ */

  // Inline SVGs (stroke styling comes from content.css).
  const svg = (shapes) =>
    `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${shapes}</svg>`;

  const ICONS = {
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    rotate: svg('<rect x="5" y="10" width="14" height="9" rx="2"/><path d="M8 6.5A6 6 0 0 1 16 6.5M16 3.5v3h-3"/>'),
    reload: svg('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
    touch: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/>'),
    camera: svg('<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
    help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1 1-1.1 1.8M12 17h.01"/>'),
    home: svg('<path d="M4 11l8-7 8 7M6 10v9h12v-9"/>'),
    bookmark: svg('<path d="M7 4h10v16l-5-4-5 4z"/>'),
    grip: svg('<path d="M20 10L10 20M20 15l-5 5"/>'),
    trash: svg('<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>'),
    eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  };

  const DEVICES = {
    mobile: {
      label: 'Mobile',
      icon: svg('<rect x="7" y="2.5" width="10" height="19" rx="2.6"/><path d="M10.5 18.25h3"/>'),
    },
    tablet: {
      label: 'Tablet',
      icon: svg('<rect x="4.5" y="2.5" width="15" height="19" rx="2.6"/><path d="M10.5 18.25h3"/>'),
    },
    desktop: {
      label: 'Desktop',
      icon: svg('<rect x="3" y="4" width="18" height="12.5" rx="2"/><path d="M8.5 20.25h7M12 16.5v3.75"/>'),
    },
  };
  const DEVICE_IDS = Object.keys(DEVICES);

  /* ------------------------------------------------------------------ *
   *  Presets (w/h are the portrait CSS-pixel screen size; 0×0 = fluid)
   * ------------------------------------------------------------------ */

  const PRESETS = [
    { id: 'iphone-15-pro', label: 'iPhone 15 Pro', type: 'mobile', w: 393, h: 852 },
    { id: 'iphone-15-pro-max', label: 'iPhone 15 Pro Max', type: 'mobile', w: 430, h: 932 },
    { id: 'pixel-8', label: 'Pixel 8', type: 'mobile', w: 412, h: 915 },
    { id: 'galaxy-s23', label: 'Galaxy S23', type: 'mobile', w: 360, h: 780 },
    { id: 'small-phone', label: 'Small phone', type: 'mobile', w: 320, h: 568 },
    { id: 'ipad-mini', label: 'iPad mini', type: 'tablet', w: 744, h: 1133 },
    { id: 'ipad-air', label: 'iPad Air', type: 'tablet', w: 820, h: 1180 },
    { id: 'ipad-pro-13', label: 'iPad Pro 12.9"', type: 'tablet', w: 1024, h: 1366 },
    { id: 'fluid', label: 'Desktop (fluid)', type: 'desktop', w: 0, h: 0 },
    { id: 'laptop', label: 'Laptop', type: 'desktop', w: 1280, h: 800 },
    { id: 'desktop-hd', label: 'Desktop HD', type: 'desktop', w: 1440, h: 900 },
    { id: 'full-hd', label: 'Full HD', type: 'desktop', w: 1920, h: 1080 },
  ];
  const TYPE_DEFAULTS = { mobile: 'iphone-15-pro', tablet: 'ipad-air', desktop: 'fluid' };

  // Breakpoint sets shown as markers on the ruler.
  const BREAKPOINTS = {
    tailwind: [['sm', 640], ['md', 768], ['lg', 1024], ['xl', 1280], ['2xl', 1536]],
    bootstrap: [['sm', 576], ['md', 768], ['lg', 992], ['xl', 1200], ['xxl', 1400]],
  };
  const BASE_NAME = { tailwind: 'base', bootstrap: 'xs' };

  // Vision filters applied to the preview iframe. The colour-blindness ones are
  // SVG feColorMatrix filters defined inside the overlay (see buildOverlay).
  const VISION = {
    none: 'None',
    protanopia: 'Protanopia (no red)',
    deuteranopia: 'Deuteranopia (no green)',
    tritanopia: 'Tritanopia (no blue)',
    achromatopsia: 'Achromatopsia (grayscale)',
    'low-contrast': 'Low contrast',
    blur: 'Blurred vision',
  };
  const VISION_FILTERS = {
    none: '',
    protanopia: 'url(#rs-f-protanopia)',
    deuteranopia: 'url(#rs-f-deuteranopia)',
    tritanopia: 'url(#rs-f-tritanopia)',
    achromatopsia: 'url(#rs-f-achromatopsia)',
    'low-contrast': 'contrast(0.45) brightness(1.1)',
    blur: 'blur(1.5px)',
  };
  const CB_MATRICES = {
    protanopia: '0.567 0.433 0 0 0  0.558 0.442 0 0 0  0 0.242 0.758 0 0  0 0 0 1 0',
    deuteranopia: '0.625 0.375 0 0 0  0.7 0.3 0 0 0  0 0.3 0.7 0 0  0 0 0 1 0',
    tritanopia: '0.95 0.05 0 0 0  0 0.433 0.567 0 0  0 0.475 0.525 0 0  0 0 0 1 0',
    achromatopsia: '0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0 0 0 1 0',
  };

  // Injected into the (same-origin) preview document so the page behaves like
  // a phone/tablet: no classic scrollbars eating into the viewport width, and
  // no overscroll / swipe-back gestures leaking out of the preview.
  const FRAME_CSS_BASE = 'html,body{overscroll-behavior:contain!important}';
  const FRAME_CSS_SCROLLBARS =
    '*{scrollbar-width:none!important}*::-webkit-scrollbar{display:none!important}';
  const TOUCH_CURSOR =
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E" +
    "%3Ccircle cx='12' cy='12' r='10' fill='rgba(124,58,237,.25)' stroke='rgb(124,58,237)' " +
    "stroke-width='1.5'/%3E%3C/svg%3E\") 12 12, auto";
  const FRAME_CSS_TOUCH = `html,html *{cursor:${TOUCH_CURSOR}!important}`;

  const SHORTCUTS = [
    ['Esc', 'Close preview'],
    ['R', 'Reload'],
    ['O', 'Rotate'],
    ['[  ]', 'Previous / next device'],
    ['Alt + ← →', 'Previous / next device'],
    ['T', 'Toggle touch simulation'],
    ['S', 'Screenshot (screen)'],
    ['Shift + S', 'Screenshot (with frame)'],
    ['L  or  /', 'Focus the URL bar'],
    ['V', 'View tools (breakpoints, filters, overlay)'],
    ['?', 'Show this help'],
  ];

  let ui = null;       // refs to the live overlay, or null when closed
  let opening = false; // true while the saved state is being read from storage
  let resizeQueued = false;
  const boundDocs = new WeakSet(); // preview documents that already have our listeners

  /* ------------------------------------------------------------------ *
   *  Small helpers
   * ------------------------------------------------------------------ */

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

  function send(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          void chrome.runtime.lastError; // read it so Chrome doesn't log "unchecked"
          resolve(response);
        });
      } catch (_) {
        resolve(undefined); // extension context invalidated
      }
    });
  }

  function clampSize(value) {
    const n = Math.round(Number(value));
    return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Number.isFinite(n) ? n : MIN_SIZE));
  }

  // 0 means "fluid"; anything else is clamped into the supported range.
  function readDim(value) {
    const n = Math.round(Number(value));
    return n > 0 ? clampSize(n) : 0;
  }

  /* ------------------------------------------------------------------ *
   *  Persistence (chrome.storage.local)
   * ------------------------------------------------------------------ */

  function defaultState(type = 'mobile') {
    const p = PRESETS.find((preset) => preset.id === TYPE_DEFAULTS[type]);
    return { presetId: p.id, type: p.type, w: p.w, h: p.h, touch: true, bp: 'tailwind', vision: 'none' };
  }

  const validBp = (v) => (v === 'off' || (typeof v === 'string' && Object.hasOwn(BREAKPOINTS, v)) ? v : 'tailwind');
  const validVision = (v) => (typeof v === 'string' && Object.hasOwn(VISION, v) ? v : 'none');

  function sanitizeState(raw, legacy) {
    if (raw && typeof raw === 'object' && DEVICE_IDS.includes(raw.type)) {
      const w = readDim(raw.w);
      const h = readDim(raw.h);
      const fixed = w > 0 && h > 0;
      if (raw.type === 'desktop' || fixed) {
        return {
          presetId: typeof raw.presetId === 'string' ? raw.presetId : 'custom',
          type: raw.type,
          w: fixed ? w : 0,
          h: fixed ? h : 0,
          touch: raw.touch !== false,
          bp: validBp(raw.bp),
          vision: validVision(raw.vision),
        };
      }
    }
    return defaultState(DEVICE_IDS.includes(legacy) ? legacy : 'mobile');
  }

  function sanitizeSaved(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (p) =>
          p &&
          typeof p.id === 'string' &&
          typeof p.label === 'string' &&
          DEVICE_IDS.includes(p.type) &&
          readDim(p.w) > 0 &&
          readDim(p.h) > 0
      )
      .map((p) => ({ id: p.id, label: p.label.slice(0, 40), type: p.type, w: readDim(p.w), h: readDim(p.h) }))
      .slice(-20);
  }

  async function loadStored() {
    let data = {};
    try {
      data = await chrome.storage.local.get([STATE_KEY, SAVED_KEY, LEGACY_KEY]);
    } catch (_) {
      // first use, or the extension context was invalidated
    }
    return {
      state: sanitizeState(data[STATE_KEY], data[LEGACY_KEY]),
      saved: sanitizeSaved(data[SAVED_KEY]),
    };
  }

  function safeSet(values) {
    Promise.resolve()
      .then(() => chrome.storage.local.set(values))
      .catch(() => {});
  }

  function saveState() {
    if (!ui) return;
    const { presetId, type, w, h, touch, bp, vision } = ui.state;
    safeSet({ [STATE_KEY]: { presetId, type, w, h, touch, bp, vision } });
  }

  const persistSaved = () => safeSet({ [SAVED_KEY]: ui ? ui.saved : [] });

  /* ------------------------------------------------------------------ *
   *  DOM
   * ------------------------------------------------------------------ */

  function buildOverlay() {
    const root = document.createElement('div');
    root.id = ROOT_ID;

    const typeButtons = DEVICE_IDS.map((id) => {
      const { label, icon } = DEVICES[id];
      return (
        `<button type="button" class="rs-tool" data-device="${id}" ` +
        `title="${label}" aria-label="${label}" aria-pressed="false">${icon}</button>`
      );
    }).join('');

    const tool = (action, icon, title, extra = '') =>
      `<button type="button" class="rs-tool ${extra}" data-action="${action}" ` +
      `title="${title}" aria-label="${title}">${icon}</button>`;

    const help = SHORTCUTS.map(([keys, text]) => `<div><kbd>${keys}</kbd><span>${text}</span></div>`).join('');
    const visionOptions = Object.entries(VISION)
      .map(([id, label]) => `<option value="${id}">${label}</option>`)
      .join('');
    const filters = Object.entries(CB_MATRICES)
      .map(
        ([id, values]) =>
          `<filter id="rs-f-${id}" color-interpolation-filters="sRGB">` +
          `<feColorMatrix type="matrix" values="${values}"/></filter>`
      )
      .join('');

    root.innerHTML = `
      <div class="rs-backdrop"></div>
      <svg class="rs-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>${filters}</defs></svg>

      <div class="rs-topbar">
        <select class="rs-select" aria-label="Device preset" title="Device preset ( [ and ] to cycle )"></select>
        <input class="rs-input rs-num" data-dim="w" type="number" inputmode="numeric"
               min="${MIN_SIZE}" max="${MAX_SIZE}" aria-label="Width in pixels" title="Width (px)">
        <span class="rs-x">×</span>
        <input class="rs-input rs-num" data-dim="h" type="number" inputmode="numeric"
               min="${MIN_SIZE}" max="${MAX_SIZE}" aria-label="Height in pixels" title="Height (px)">
        ${tool('save', ICONS.bookmark, 'Save this size as a preset', 'rs-tool--sm')}
        <span class="rs-vsep"></span>
        ${tool('home', ICONS.home, 'Back to this tab\u2019s URL', 'rs-tool--sm')}
        <input class="rs-input rs-url" type="text" spellcheck="false" autocomplete="off"
               aria-label="Preview URL" placeholder="URL or /path \u2014 Enter to load" title="URL or /path (L)">
        <div class="rs-status" data-kind="idle" role="status">
          <span class="rs-status-dot"></span><span class="rs-status-text">Idle</span>
        </div>
      </div>

      <div class="rs-stage">
        <div class="rs-device rs-device--mobile">
          <span class="rs-hw rs-hw--m rs-hw--action"></span>
          <span class="rs-hw rs-hw--m rs-hw--vol-up"></span>
          <span class="rs-hw rs-hw--m rs-hw--vol-down"></span>
          <span class="rs-hw rs-hw--m rs-hw--power"></span>
          <span class="rs-hw rs-hw--t rs-hw--top-power"></span>
          <span class="rs-hw rs-hw--t rs-hw--side-up"></span>
          <span class="rs-hw rs-hw--t rs-hw--side-down"></span>

          <div class="rs-screen">
            <iframe class="rs-iframe" title="ResponsiveSnap device preview"></iframe>
            <div class="rs-design" aria-hidden="true"></div>
            <div class="rs-fail" role="alert">
              <h3></h3>
              <p></p>
              <div class="rs-fail-actions">
                <button type="button" class="rs-btn" data-action="retry">Retry</button>
                <button type="button" class="rs-btn rs-btn--ghost" data-action="newtab">Open in new tab</button>
              </div>
            </div>
          </div>

          <span class="rs-island"></span>
          <span class="rs-home"></span>

          <div class="rs-ruler"><span class="rs-ruler-label"></span></div>
          <div class="rs-grip" title="Drag to resize">${ICONS.grip}</div>
        </div>
      </div>

      <div class="rs-sidebar" role="toolbar" aria-orientation="vertical" aria-label="ResponsiveSnap toolbox">
        ${tool('close', ICONS.close, 'Close (Esc)', 'rs-tool--close')}
        <span class="rs-sep"></span>
        ${typeButtons}
        <span class="rs-sep"></span>
        ${tool('rotate', ICONS.rotate, 'Rotate (O)')}
        ${tool('reload', ICONS.reload, 'Reload (R)')}
        ${tool('touch', ICONS.touch, 'Touch simulation (T)')}
        ${tool('shots', ICONS.camera, 'Screenshot (S)')}
        ${tool('view', ICONS.eye, 'View tools (V)')}
        <span class="rs-spacer"></span>
        ${tool('help', ICONS.help, 'Keyboard shortcuts (?)')}
      </div>

      <div class="rs-panel" data-panel="shots">
        <h4>Screenshot</h4>
        <button type="button" class="rs-btn rs-btn--block" data-action="shot-screen">Screen only <kbd>S</kbd></button>
        <button type="button" class="rs-btn rs-btn--block" data-action="shot-frame">With device frame <kbd>Shift S</kbd></button>
        <p class="rs-hint">Saved as a PNG, at the scale it is shown on screen.</p>
      </div>

      <div class="rs-panel" data-panel="save">
        <h4>Save size as preset</h4>
        <div class="rs-row">
          <input class="rs-input rs-name" type="text" maxlength="40" placeholder="Preset name" aria-label="Preset name">
          <button type="button" class="rs-btn" data-action="save-confirm">Save</button>
        </div>
        <div class="rs-saved"></div>
      </div>

      <div class="rs-panel" data-panel="view">
        <h4>View tools</h4>
        <label class="rs-field"><span>Breakpoint markers</span>
          <select class="rs-select" data-field="bp" aria-label="Breakpoint set">
            <option value="tailwind">Tailwind</option>
            <option value="bootstrap">Bootstrap</option>
            <option value="off">Off</option>
          </select>
        </label>
        <label class="rs-field"><span>Vision filter</span>
          <select class="rs-select" data-field="vision" aria-label="Vision filter">${visionOptions}</select>
        </label>
        <h4 class="rs-h4-gap">Design overlay</h4>
        <input type="file" class="rs-file" accept="image/*" hidden>
        <div class="rs-row">
          <button type="button" class="rs-btn" data-action="overlay-pick">Choose image…</button>
          <button type="button" class="rs-btn rs-btn--ghost" data-action="overlay-clear">Remove</button>
        </div>
        <label class="rs-field"><span>Opacity <b class="rs-opacity-val">50%</b></span>
          <input type="range" class="rs-range" data-field="opacity" min="5" max="100" value="50">
        </label>
        <label class="rs-field rs-field--inline">
          <input type="checkbox" data-field="difference"><span>Difference blend (highlights mismatches)</span>
        </label>
        <label class="rs-field"><span>Offset Y (px)</span>
          <input type="number" class="rs-input rs-num" data-field="offset" value="0" step="1">
        </label>
        <p class="rs-hint">The image is scaled to the device width and stays pinned to the top of the screen. Use the offset to line it up with a scrolled page.</p>
      </div>

      <div class="rs-panel" data-panel="help">
        <h4>Keyboard shortcuts</h4>
        <div class="rs-keys">${help}</div>
        <p class="rs-hint">Shortcuts work while the preview has focus. Touch simulation only works for same-origin pages.</p>
      </div>

      <div class="rs-toast" role="status"></div>`;

    return root;
  }

  function mount({ state, saved }) {
    const root = buildOverlay();
    lockPageScroll(root);
    // <html>, not <body>: a transformed/filtered <body> would break position:fixed.
    document.documentElement.appendChild(root);

    const $ = (selector) => root.querySelector(selector);
    ui = {
      root,
      stage: $('.rs-stage'),
      frame: $('.rs-device'),
      screen: $('.rs-screen'),
      iframe: $('.rs-iframe'),
      select: $('.rs-select'),
      wInput: $('[data-dim="w"]'),
      hInput: $('[data-dim="h"]'),
      urlInput: $('.rs-url'),
      nameInput: $('.rs-name'),
      savedList: $('.rs-saved'),
      status: $('.rs-status'),
      statusText: $('.rs-status-text'),
      fail: $('.rs-fail'),
      ruler: $('.rs-ruler-label'),
      grip: $('.rs-grip'),
      toast: $('.rs-toast'),
      typeTools: Array.from(root.querySelectorAll('.rs-tool[data-device]')),
      touchTool: $('[data-action="touch"]'),
      viewTool: $('[data-action="view"]'),
      rulerBox: $('.rs-ruler'),
      design: $('.rs-design'),
      fileInput: $('.rs-file'),
      bpSelect: $('[data-field="bp"]'),
      visionSelect: $('[data-field="vision"]'),
      opacityInput: $('[data-field="opacity"]'),
      opacityVal: $('.rs-opacity-val'),
      diffInput: $('[data-field="difference"]'),
      offsetInput: $('[data-field="offset"]'),
      panels: Array.from(root.querySelectorAll('.rs-panel')),
      state,
      saved,
      statusKind: 'idle',
      targetUrl: '',
      currentUrl: '',
      navToken: 0,
      t0: 0,
      failed: false,
      capturing: false,
      dragging: null,
      slowTimer: 0,
      toastTimer: 0,
      ro: null,
      ticks: [],
      ticksFor: null,
      overlayUrl: '',
    };

    root.addEventListener('click', onClick);
    ui.select.addEventListener('change', onPresetChange);
    [ui.wInput, ui.hInput].forEach((input) => {
      input.addEventListener('change', onDimChange);
      input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur());
    });
    ui.urlInput.addEventListener('keydown', onUrlKey);
    ui.nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && savePreset());
    ui.iframe.addEventListener('load', onIframeLoad);
    ui.grip.addEventListener('pointerdown', onGripDown);
    ui.grip.addEventListener('pointermove', onGripMove);
    ui.grip.addEventListener('pointerup', onGripUp);
    ui.grip.addEventListener('pointercancel', onGripUp);
    root.addEventListener('input', onField);
    root.addEventListener('change', onField);
    window.addEventListener('resize', onResize);
    document.addEventListener('keydown', onKey, true);

    ui.ro = new ResizeObserver(updateMeta);
    ui.ro.observe(ui.iframe);

    buildSelect();
    instantly(() => render({ persist: false }));
    navigate(window.location.href);
  }

  function closeOverlay() {
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKey, true);
    if (ui) {
      clearTimeout(ui.slowTimer);
      clearTimeout(ui.toastTimer);
      if (ui.ro) ui.ro.disconnect();
      clearOverlayUrl();
    }
    send({ type: 'RS_UNWATCH' });
    const root = document.getElementById(ROOT_ID); // also cleans up an orphaned overlay
    if (root) {
      unlockPageScroll(root);
      root.remove(); // removing the root destroys the iframe too
    }
    ui = null;
  }

  /**
   * Freezes the page underneath while the overlay is open. Dropping the page's
   * own scrollbar also lets the toolbox sit flush against the window edge. The
   * previous inline values live on the overlay element itself, so they are
   * restored correctly even if this script instance has been replaced.
   */
  const SCROLL_PROPS = ['overflow-x', 'overflow-y'];

  function lockPageScroll(root) {
    const inline = document.documentElement.style;
    const saved = SCROLL_PROPS.map((prop) => [
      prop,
      inline.getPropertyValue(prop),
      inline.getPropertyPriority(prop),
    ]);
    root.dataset.rsScroll = JSON.stringify(saved);
    SCROLL_PROPS.forEach((prop) => inline.setProperty(prop, 'hidden', 'important'));
  }

  function unlockPageScroll(root) {
    const inline = document.documentElement.style;
    let saved = [];
    try {
      saved = JSON.parse(root.dataset.rsScroll || '[]');
    } catch (_) {}
    SCROLL_PROPS.forEach((prop) => inline.removeProperty(prop));
    saved.forEach(([prop, value, priority]) => {
      if (value) inline.setProperty(prop, value, priority);
    });
  }

  /* ------------------------------------------------------------------ *
   *  Rendering the device state
   * ------------------------------------------------------------------ */

  const allPresets = () => PRESETS.concat(ui.saved);
  const touchActive = () => ui.state.touch && ui.state.type !== 'desktop';
  const currentScale = () => parseFloat(ui.frame.style.getPropertyValue('--rs-scale')) || 1;

  function presetOption(p) {
    const option = document.createElement('option');
    option.value = p.id;
    option.textContent = p.w ? `${p.label} \u00b7 ${p.w}\u00d7${p.h}` : p.label;
    return option;
  }

  function buildSelect() {
    const select = ui.select;
    select.textContent = '';
    [['Mobile', 'mobile'], ['Tablet', 'tablet'], ['Desktop', 'desktop']].forEach(([label, type]) => {
      const group = document.createElement('optgroup');
      group.label = label;
      PRESETS.filter((p) => p.type === type).forEach((p) => group.appendChild(presetOption(p)));
      select.appendChild(group);
    });
    if (ui.saved.length) {
      const group = document.createElement('optgroup');
      group.label = 'Saved';
      ui.saved.forEach((p) => group.appendChild(presetOption(p)));
      select.appendChild(group);
    }
    const custom = document.createElement('option');
    custom.value = 'custom';
    custom.textContent = 'Custom size';
    select.appendChild(custom);
    syncSelect();
  }

  function syncSelect() {
    const known = allPresets().some((p) => p.id === ui.state.presetId);
    ui.select.value = known ? ui.state.presetId : 'custom';
  }

  /**
   * Single source of truth: pushes ui.state into the DOM. The frame class and
   * two CSS variables are all it takes – sizes, bezel, radius, notch and
   * hardware buttons are driven by CSS transitions.
   */
  function render({ persist = true } = {}) {
    if (!ui) return;
    const { frame, state: s } = ui;
    const fixed = s.w > 0 && s.h > 0;

    DEVICE_IDS.forEach((id) => frame.classList.toggle(`rs-device--${id}`, id === s.type));
    frame.classList.toggle('rs-fixed', fixed);
    frame.classList.toggle('rs-landscape', fixed && s.type !== 'desktop' && s.w > s.h);
    if (fixed) {
      frame.style.setProperty('--rs-sw', String(s.w));
      frame.style.setProperty('--rs-sh', String(s.h));
    } else {
      frame.style.removeProperty('--rs-sw');
      frame.style.removeProperty('--rs-sh');
    }

    ui.typeTools.forEach((tool) => {
      const active = tool.dataset.device === s.type;
      tool.classList.toggle('is-active', active);
      tool.setAttribute('aria-pressed', String(active));
    });
    ui.touchTool.classList.toggle('is-active', touchActive());
    ui.touchTool.classList.toggle('is-dim', s.type === 'desktop');

    syncSelect();
    applyView();
    fit();
    if (!ui.dragging) tuneFrameDocument();
    updateMeta();
    if (persist) saveState();
  }

  /**
   * Phone/tablet frames keep their true CSS-pixel size (so media queries inside
   * the preview match the real device) and are scaled with a transform when the
   * window is too small. Sizes are read from the CSS custom properties, so the
   * same code handles presets, custom sizes and the fluid desktop (no size set
   * -> never scaled).
   */
  function fit() {
    if (!ui || ui.dragging) return;
    const css = getComputedStyle(ui.frame);
    const screenW = parseFloat(css.getPropertyValue('--rs-sw'));
    const screenH = parseFloat(css.getPropertyValue('--rs-sh'));
    const bezel = parseFloat(css.getPropertyValue('--rs-bezel')) || 0;

    let scale = 1;
    if (screenW > 0 && screenH > 0) {
      const availW = ui.stage.clientWidth - FIT_MARGIN * 2;
      const availH = ui.stage.clientHeight - FIT_MARGIN * 2;
      scale = Math.min(1, availW / (screenW + bezel * 2), availH / (screenH + bezel * 2));
    }
    ui.frame.style.setProperty('--rs-scale', Math.max(scale, 0.1).toFixed(4));
  }

  /** Runs a style update with CSS transitions disabled (first paint, window resize). */
  function instantly(update) {
    const { root } = ui;
    root.classList.add('rs-instant');
    update();
    void root.offsetWidth; // flush styles while transitions are still off
    root.classList.remove('rs-instant');
  }

  function onResize() {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      if (ui) instantly(fit);
    });
  }

  /** Ruler label + W/H inputs. Driven by a ResizeObserver so it follows animations. */
  function updateMeta() {
    if (!ui) return;
    const w = Math.round(ui.iframe.clientWidth);
    const h = Math.round(ui.iframe.clientHeight);
    const scale = currentScale();
    let active = null;
    ui.ticks.forEach((tick) => {
      const inside = tick.px < w;
      tick.el.style.display = inside ? '' : 'none';
      if (inside) tick.el.style.left = `${(tick.px / w) * 100}%`;
      if (tick.px <= w) active = tick;
    });
    ui.ticks.forEach((tick) => tick.el.classList.toggle('is-current', tick === active));
    const parts = [`${w} px`];
    if (ui.state.bp !== 'off') parts.push(active ? active.name : BASE_NAME[ui.state.bp]);
    if (scale < 0.995) parts.push(`${Math.round(scale * 100)}%`);
    ui.ruler.textContent = parts.join(' \u00b7 ');

    const fixed = ui.state.w > 0 && ui.state.h > 0;
    if (document.activeElement !== ui.wInput) ui.wInput.value = fixed ? ui.state.w : w;
    if (document.activeElement !== ui.hInput) ui.hInput.value = fixed ? ui.state.h : h;
  }

  /* ------------------------------------------------------------------ *
   *  Device actions
   * ------------------------------------------------------------------ */

  function selectPreset(p) {
    const s = ui.state;
    const wasLandscape = s.type !== 'desktop' && s.w > s.h;
    let { w, h } = p;
    // Keep the current orientation when hopping between phones / tablets.
    if (p.type !== 'desktop' && w > 0 && h > 0 && w > h !== wasLandscape) [w, h] = [h, w];
    ui.state = { ...s, presetId: p.id, type: p.type, w, h };
    render();
  }

  function pickType(type) {
    selectPreset(PRESETS.find((p) => p.id === TYPE_DEFAULTS[type]));
  }

  function cycle(direction) {
    const list = allPresets();
    const index = list.findIndex((p) => p.id === ui.state.presetId);
    const next = list[(index + direction + list.length) % list.length];
    selectPreset(next);
    toast(next.label);
  }

  function rotate() {
    const s = ui.state;
    const fixed = s.w > 0 && s.h > 0;
    // The fluid desktop has no fixed size yet: freeze the current one, then swap it.
    const w = fixed ? s.w : Math.round(ui.iframe.clientWidth);
    const h = fixed ? s.h : Math.round(ui.iframe.clientHeight);
    ui.state = { ...s, presetId: fixed ? s.presetId : 'custom', w: h, h: w };
    render();
  }

  function toggleTouch() {
    if (ui.state.type === 'desktop') {
      toast('Touch simulation is for phone and tablet frames');
      return;
    }
    ui.state = { ...ui.state, touch: !ui.state.touch };
    render();
    toast(ui.state.touch ? 'Touch simulation on' : 'Touch simulation off');
  }

  function onPresetChange() {
    const p = allPresets().find((preset) => preset.id === ui.select.value);
    ui.select.blur();
    if (p) selectPreset(p);
  }

  function onDimChange() {
    const w = parseInt(ui.wInput.value, 10);
    const h = parseInt(ui.hInput.value, 10);
    if (!Number.isFinite(w) || !Number.isFinite(h)) {
      updateMeta();
      return;
    }
    ui.state = { ...ui.state, presetId: 'custom', w: clampSize(w), h: clampSize(h) };
    render();
  }

  /* ---- interactive resize (corner grip) ---- */

  function onGripDown(event) {
    if (!ui || event.button !== 0) return;
    event.preventDefault();
    ui.grip.setPointerCapture(event.pointerId);
    ui.dragging = {
      x: event.clientX,
      y: event.clientY,
      w: ui.iframe.clientWidth,
      h: ui.iframe.clientHeight,
      scale: currentScale(),
    };
    ui.root.classList.add('rs-instant', 'rs-resizing');
  }

  function onGripMove(event) {
    const d = ui && ui.dragging;
    if (!d) return;
    // The device grows from its centre, so the edge moves half as far as the size changes.
    const w = clampSize(d.w + (2 * (event.clientX - d.x)) / d.scale);
    const h = clampSize(d.h + (2 * (event.clientY - d.y)) / d.scale);
    ui.state = { ...ui.state, presetId: 'custom', w, h };
    render({ persist: false });
  }

  function onGripUp() {
    if (!ui || !ui.dragging) return;
    ui.dragging = null;
    ui.root.classList.remove('rs-instant', 'rs-resizing');
    render();
  }

  /* ---- view tools: breakpoint markers, vision filters, design overlay ---- */

  function buildTicks() {
    ui.ticksFor = ui.state.bp;
    ui.rulerBox.querySelectorAll('.rs-tick').forEach((node) => node.remove());
    ui.ticks = (BREAKPOINTS[ui.state.bp] || []).map(([name, px]) => {
      const el = document.createElement('span');
      el.className = 'rs-tick';
      const label = document.createElement('span');
      label.className = 'rs-tick-label';
      label.textContent = name;
      el.appendChild(label);
      ui.rulerBox.appendChild(el);
      return { el, px, name };
    });
  }

  function applyView() {
    const { bp, vision } = ui.state;
    ui.iframe.style.filter = VISION_FILTERS[vision] || '';
    ui.bpSelect.value = bp;
    ui.visionSelect.value = vision;
    ui.viewTool.classList.toggle('is-active', vision !== 'none' || !!ui.overlayUrl);
    if (ui.ticksFor !== bp) buildTicks();
  }

  function applyOverlay() {
    ui.design.style.opacity = String(Number(ui.opacityInput.value) / 100);
    ui.opacityVal.textContent = `${ui.opacityInput.value}%`;
    ui.design.style.mixBlendMode = ui.diffInput.checked ? 'difference' : 'normal';
    ui.design.style.backgroundPosition = `center ${Number(ui.offsetInput.value) || 0}px`;
  }

  function clearOverlayUrl() {
    if (ui && ui.overlayUrl) {
      URL.revokeObjectURL(ui.overlayUrl);
      ui.overlayUrl = '';
    }
  }

  function loadOverlay(file) {
    if (!file || !/^image\//.test(file.type)) {
      toast('Choose an image file');
      return;
    }
    clearOverlayUrl();
    ui.overlayUrl = URL.createObjectURL(file);
    ui.design.style.backgroundImage = `url("${ui.overlayUrl}")`;
    ui.design.classList.add('is-visible');
    applyOverlay();
    applyView();
    toast('Design overlay on');
  }

  function clearOverlay() {
    clearOverlayUrl();
    ui.design.classList.remove('is-visible');
    ui.design.style.backgroundImage = '';
    applyView();
  }

  /** Handles every control inside the "View tools" panel (input + change events). */
  function onField(event) {
    const t = event.target;
    if (!ui || !(t instanceof Element)) return;

    if (t === ui.fileInput) {
      if (event.type === 'change') {
        loadOverlay(t.files && t.files[0]);
        t.value = '';
      }
      return;
    }

    switch (t.dataset.field) {
      case 'bp':
        ui.state = { ...ui.state, bp: validBp(t.value) };
        render();
        break;
      case 'vision':
        ui.state = { ...ui.state, vision: validVision(t.value) };
        render();
        break;
      case 'opacity':
      case 'difference':
      case 'offset':
        applyOverlay();
        break;
      default:
        return;
    }
    // Sliders and checkboxes keep focus otherwise, which would swallow shortcuts.
    if (event.type === 'change' && (t.type === 'range' || t.type === 'checkbox')) t.blur();
    if (event.type === 'change' && t.tagName === 'SELECT') t.blur();
  }

  /* ---- saved presets ---- */

  function renderSavedList() {
    ui.savedList.textContent = '';
    ui.saved.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'rs-saved-row';
      const name = document.createElement('span');
      name.textContent = `${p.label} \u00b7 ${p.w}\u00d7${p.h}`;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'rs-tool rs-tool--sm rs-tool--close';
      del.dataset.action = 'delete-saved';
      del.dataset.id = p.id;
      del.title = 'Delete';
      del.innerHTML = ICONS.trash;
      row.append(name, del);
      ui.savedList.appendChild(row);
    });
  }

  function savePreset() {
    const s = ui.state;
    const fixed = s.w > 0 && s.h > 0;
    const w = fixed ? s.w : Math.round(ui.iframe.clientWidth);
    const h = fixed ? s.h : Math.round(ui.iframe.clientHeight);
    const label = ui.nameInput.value.trim().slice(0, 40) || `${w}\u00d7${h}`;
    const preset = { id: `saved-${Date.now()}`, label, type: s.type, w, h };

    ui.saved = ui.saved.concat(preset).slice(-20);
    persistSaved();
    ui.nameInput.value = '';
    buildSelect();
    ui.state = { ...s, presetId: preset.id, w, h };
    render();
    closePanels();
    toast(`Saved \u201c${label}\u201d`);
  }

  function deleteSaved(id) {
    ui.saved = ui.saved.filter((p) => p.id !== id);
    persistSaved();
    if (ui.state.presetId === id) ui.state = { ...ui.state, presetId: 'custom' };
    buildSelect();
    renderSavedList();
    render();
  }

  /* ------------------------------------------------------------------ *
   *  Navigation, status and errors
   * ------------------------------------------------------------------ */

  function normalizeUrl(raw) {
    const value = String(raw || '').trim();
    if (!value) return null;
    const base = ui.currentUrl || window.location.href;
    const hostLike = /^(localhost|(\d{1,3}\.){3}\d{1,3}|([\w-]+\.)+[a-z]{2,})(:\d+)?([/?#].*)?$/i;
    try {
      let url;
      if (hostLike.test(value)) {
        const local = /^(localhost|(\d{1,3}\.){3}\d{1,3})/i.test(value);
        url = new URL((local ? 'http://' : 'https://') + value);
      } else if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
        url = new URL(value);
      } else {
        url = new URL(value, base); // "/pricing", "?page=2", "../about" ...
      }
      return ['http:', 'https:', 'file:'].includes(url.protocol) ? url.href : null;
    } catch (_) {
      return null;
    }
  }

  function setStatus(kind, text) {
    ui.statusKind = kind;
    ui.status.dataset.kind = kind;
    ui.statusText.textContent = text;
  }

  function setUrlField(url) {
    if (!url || url === 'about:blank') return;
    ui.currentUrl = url;
    if (document.activeElement !== ui.urlInput) ui.urlInput.value = url;
  }

  function liveUrl() {
    try {
      const href = ui.iframe.contentWindow.location.href;
      if (href && href !== 'about:blank') return href;
    } catch (_) {
      // cross-origin: fall back to what the background worker reported
    }
    return ui.currentUrl || ui.targetUrl;
  }

  async function navigate(url) {
    if (!ui) return;
    const token = ++ui.navToken;
    ui.targetUrl = url;
    ui.failed = false;
    ui.t0 = performance.now();
    hideFail();
    setStatus('loading', 'Loading\u2026');
    setUrlField(url);

    clearTimeout(ui.slowTimer);
    ui.slowTimer = setTimeout(() => {
      if (ui && ui.statusKind === 'loading') setStatus('slow', 'Still loading\u2026');
    }, SLOW_MS);

    // Tell the background worker which frame to watch *before* it starts loading.
    await Promise.race([send({ type: 'RS_WATCH', url }), sleep(300)]);
    if (!ui || token !== ui.navToken) return;
    ui.iframe.src = url; // assigning the same URL again re-navigates (= reload)
  }

  function reload() {
    navigate(liveUrl());
  }

  function onUrlKey(event) {
    if (event.key !== 'Enter') return;
    const url = normalizeUrl(ui.urlInput.value);
    if (!url) {
      toast('Enter a valid http(s) URL or a /path');
      return;
    }
    ui.urlInput.blur();
    navigate(url);
  }

  function onIframeLoad() {
    if (!ui) return;
    tuneFrameDocument();
    const token = ui.navToken;
    // Give the background worker a moment to report a failed navigation: Chrome
    // fires "load" for its own error page too.
    setTimeout(() => {
      if (!ui || token !== ui.navToken) return;
      clearTimeout(ui.slowTimer);
      setUrlField(liveUrl());
      if (ui.failed) return;
      hideFail();
      setStatus('ok', `Loaded \u00b7 ${Math.round(performance.now() - ui.t0)} ms`);
    }, 150);
  }

  function describeError(code = '') {
    const c = String(code).replace(/^net::/, '');
    if (/NAME_NOT_RESOLVED/.test(c))
      return ['Address not found', 'The domain could not be resolved. Check the URL for typos.'];
    if (/INTERNET_DISCONNECTED|NETWORK_CHANGED/.test(c))
      return ['No connection', 'Your device appears to be offline.'];
    if (/CONNECTION_REFUSED/.test(c))
      return ['Connection refused', 'Nothing is accepting connections at this address. If this is a dev server, make sure it is running.'];
    if (/TIMED_OUT/.test(c))
      return ['Timed out', 'The server took too long to respond.'];
    if (/CONNECTION_RESET|CONNECTION_CLOSED|EMPTY_RESPONSE/.test(c))
      return ['Connection dropped', 'The server closed the connection without a proper response.'];
    if (/BLOCKED_BY_RESPONSE|BLOCKED_BY_CSP|BLOCKED_BY_XSS/.test(c))
      return ['Embedding blocked', 'This site forbids being shown inside a frame (frame-ancestors, COOP or COEP). Open it in a normal tab instead.'];
    if (/BLOCKED_BY_CLIENT/.test(c))
      return ['Request blocked', 'Another extension or browser policy blocked this request.'];
    if (/CERT|SSL/.test(c))
      return ['Certificate problem', 'The HTTPS certificate is invalid or untrusted.'];
    return ['Failed to load', c || 'The page could not be loaded.'];
  }

  function showFail(code) {
    const [title, text] = describeError(code);
    ui.fail.querySelector('h3').textContent = title;
    ui.fail.querySelector('p').textContent = text;
    ui.fail.classList.add('is-visible');
    clearTimeout(ui.slowTimer);
    setStatus('error', 'Failed');
  }

  function hideFail() {
    if (ui) ui.fail.classList.remove('is-visible');
  }

  /** Messages pushed by background.js from chrome.webNavigation. */
  function onFrameEvent(m) {
    if (!ui) return;
    if (m.phase === 'loading') {
      ui.failed = false;
      ui.t0 = performance.now();
      hideFail();
      setStatus('loading', 'Loading\u2026');
      setUrlField(m.url);
    } else if (m.phase === 'done') {
      setUrlField(m.url);
    } else if (m.phase === 'error') {
      if (/ERR_ABORTED/.test(m.error || '')) return; // superseded navigation or a download
      ui.failed = true;
      showFail(m.error);
    }
  }

  /* ------------------------------------------------------------------ *
   *  Preview document tweaks, touch simulation (same-origin only)
   * ------------------------------------------------------------------ */

  function tuneFrameDocument() {
    if (!ui) return;
    try {
      const doc = ui.iframe.contentDocument;
      if (!doc || !doc.documentElement) return;
      bindDocument(doc);

      let style = doc.getElementById(FRAME_STYLE_ID);
      if (!style) {
        style = doc.createElement('style');
        style.id = FRAME_STYLE_ID;
        (doc.head || doc.documentElement).appendChild(style);
      }
      const css = [FRAME_CSS_BASE];
      if (ui.state.type !== 'desktop') css.push(FRAME_CSS_SCROLLBARS);
      if (touchActive()) css.push(FRAME_CSS_TOUCH);
      style.textContent = css.join('');
    } catch (_) {
      // The preview navigated to another origin – nothing we can (or should) tweak.
    }
  }

  function bindDocument(doc) {
    if (boundDocs.has(doc)) return;
    boundDocs.add(doc);
    doc.addEventListener('keydown', onKey, true);
    bindTouch(doc);
  }

  /** Fires a synthetic touch event at `target` (viewport coordinates of its document). */
  function fireTouch(type, target, x, y) {
    const win = target.ownerDocument.defaultView;
    if (!win || typeof win.Touch !== 'function' || typeof win.TouchEvent !== 'function') return null;
    try {
      const touch = new win.Touch({
        identifier: 1,
        target,
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        pageX: x + win.scrollX,
        pageY: y + win.scrollY,
        radiusX: 11,
        radiusY: 11,
        force: 1,
      });
      const active = type === 'touchend' ? [] : [touch];
      const event = new win.TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: win,
        touches: active,
        targetTouches: active,
        changedTouches: [touch],
      });
      target.dispatchEvent(event);
      return event;
    } catch (_) {
      return null;
    }
  }

  function findScroller(node) {
    for (let el = node; el && el.nodeType === 1; el = el.parentElement) {
      const style = el.ownerDocument.defaultView.getComputedStyle(el);
      const y = /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight;
      const x = /(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth;
      if (y || x) return el;
    }
    return node.ownerDocument.scrollingElement;
  }

  /**
   * Turns mouse input into touch input: mousedown/move/up become
   * touchstart/move/end, and dragging scrolls the nearest scroll container
   * like a finger would. Real clicks still go through untouched.
   */
  function bindTouch(doc) {
    let drag = null;
    let suppressClick = false;

    const endDrag = (event) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      fireTouch('touchend', d.target, event.clientX, event.clientY);
      if (d.moved) {
        suppressClick = true; // a swipe must not end in a click
        setTimeout(() => (suppressClick = false), 0);
      }
    };

    doc.addEventListener(
      'mousedown',
      (event) => {
        if (!ui || !touchActive() || event.button !== 0) return;
        drag = {
          x: event.clientX,
          y: event.clientY,
          lx: event.clientX,
          ly: event.clientY,
          moved: false,
          target: event.target,
          scroller: findScroller(event.target),
        };
        fireTouch('touchstart', event.target, event.clientX, event.clientY);
      },
      true
    );

    doc.addEventListener(
      'mousemove',
      (event) => {
        if (!drag) return;
        if ((event.buttons & 1) === 0) return endDrag(event); // released outside the frame
        if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 6) drag.moved = true;
        if (!drag.moved) return;

        const touchMove = fireTouch('touchmove', drag.target, event.clientX, event.clientY);
        if (!(touchMove && touchMove.defaultPrevented) && drag.scroller) {
          drag.scroller.scrollBy(drag.lx - event.clientX, drag.ly - event.clientY);
        }
        drag.lx = event.clientX;
        drag.ly = event.clientY;
        event.preventDefault();
      },
      true
    );

    doc.addEventListener('mouseup', endDrag, true);
    doc.documentElement.addEventListener('mouseleave', endDrag);

    doc.addEventListener(
      'click',
      (event) => {
        if (!suppressClick) return;
        event.preventDefault();
        event.stopPropagation();
      },
      true
    );
    doc.addEventListener('dragstart', (event) => ui && touchActive() && event.preventDefault(), true);
    doc.addEventListener('selectstart', (event) => drag && event.preventDefault(), true);
  }

  /* ------------------------------------------------------------------ *
   *  Panels, toast, clicks
   * ------------------------------------------------------------------ */

  function closePanels() {
    ui.panels.forEach((panel) => panel.classList.remove('is-open'));
  }

  function togglePanel(name) {
    const panel = ui.panels.find((p) => p.dataset.panel === name);
    const open = !panel.classList.contains('is-open');
    closePanels();
    if (!open) return;
    if (name === 'save') renderSavedList();
    panel.classList.add('is-open');
    if (name === 'save') ui.nameInput.focus();
  }

  function toast(message, ms = 1800) {
    if (!ui) return;
    ui.toast.textContent = message;
    ui.toast.classList.add('is-visible');
    clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(() => ui && ui.toast.classList.remove('is-visible'), ms);
  }

  function onClick(event) {
    const target = event.target.closest('[data-action],[data-device]');
    const action = target && target.dataset.action;

    if (!event.target.closest('.rs-panel') && !['shots', 'help', 'save', 'view'].includes(action)) closePanels();
    if (!target || !ui.root.contains(target)) return;
    if (target.dataset.device) return pickType(target.dataset.device);

    switch (action) {
      case 'close': return closeOverlay();
      case 'rotate': return rotate();
      case 'reload':
      case 'retry': return reload();
      case 'touch': return toggleTouch();
      case 'shots': return togglePanel('shots');
      case 'help': return togglePanel('help');
      case 'save': return togglePanel('save');
      case 'view': return togglePanel('view');
      case 'overlay-pick': return ui.fileInput.click();
      case 'overlay-clear': return clearOverlay();
      case 'save-confirm': return savePreset();
      case 'delete-saved': return deleteSaved(target.dataset.id);
      case 'home': return navigate(window.location.href);
      case 'newtab': return void window.open(liveUrl(), '_blank', 'noopener');
      case 'shot-screen': return screenshot('screen');
      case 'shot-frame': return screenshot('frame');
      default:
    }
  }

  /* ------------------------------------------------------------------ *
   *  Keyboard
   * ------------------------------------------------------------------ */

  function onKey(event) {
    if (!ui || event.defaultPrevented) return;
    const t = event.target;
    const typing =
      !!t &&
      (t.isContentEditable ||
        (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !/^(range|checkbox|file|button)$/.test(t.type || '')));

    if (event.key === 'Escape') {
      if (ui.panels.some((p) => p.classList.contains('is-open'))) closePanels();
      else if (typing) {
        if (ui.root.contains(t)) t.blur(); // never steal Esc from the page's own inputs
        return;
      } else closeOverlay();
      event.preventDefault();
      return;
    }

    if (typing || event.ctrlKey || event.metaKey) return;

    if (event.altKey) {
      if (event.key === 'ArrowLeft') cycle(-1);
      else if (event.key === 'ArrowRight') cycle(1);
      else return;
    } else {
      switch (event.key) {
        case 'r': case 'R': reload(); break;
        case 'o': case 'O': rotate(); break;
        case '[': cycle(-1); break;
        case ']': cycle(1); break;
        case 't': case 'T': toggleTouch(); break;
        case 's': case 'S': screenshot(event.shiftKey ? 'frame' : 'screen'); break;
        case 'l': case 'L': case '/': ui.urlInput.focus(); ui.urlInput.select(); break;
        case 'v': case 'V': togglePanel('view'); break;
        case '?': togglePanel('help'); break;
        default: return;
      }
    }
    event.preventDefault();
    event.stopPropagation();
  }

  /* ------------------------------------------------------------------ *
   *  Screenshot
   * ------------------------------------------------------------------ */

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not decode the capture'));
      img.src = src;
    });
  }

  /**
   * Captures the visible tab (the overlay is on top, so that is the preview),
   * then crops it to the device screen or the whole device frame.
   */
  async function screenshot(mode) {
    if (!ui || ui.capturing) return;
    const current = ui;
    current.capturing = true;
    closePanels();
    current.toast.classList.remove('is-visible');
    current.root.classList.add('rs-capturing'); // hides ruler, grip, panels, toast

    try {
      await nextFrame();
      await nextFrame();
      await sleep(120);
      const result = await send({ type: 'RS_CAPTURE' });
      current.root.classList.remove('rs-capturing');
      if (!result || !result.ok) throw new Error((result && result.error) || 'Capture failed');

      const img = await loadImage(result.dataUrl);
      const ratio = img.naturalWidth / window.innerWidth;
      const pad = mode === 'frame' ? 14 : 0; // include the side buttons and rim
      const rect = (mode === 'frame' ? current.frame : current.screen).getBoundingClientRect();

      const sx = Math.max(0, Math.round((rect.left - pad) * ratio));
      const sy = Math.max(0, Math.round((rect.top - pad) * ratio));
      const sw = Math.min(img.naturalWidth - sx, Math.round((rect.width + pad * 2) * ratio));
      const sh = Math.min(img.naturalHeight - sy, Math.round((rect.height + pad * 2) * ratio));

      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d');
      if (mode === 'screen') {
        const radius = parseFloat(getComputedStyle(current.screen).borderTopLeftRadius) || 0;
        ctx.beginPath();
        ctx.roundRect(0, 0, sw, sh, radius * currentScale() * ratio);
        ctx.clip();
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Could not encode the PNG');

      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      const host = (window.location.hostname || 'page').replace(/[^a-z0-9.-]/gi, '_');
      const size = `${Math.round(current.iframe.clientWidth)}x${Math.round(current.iframe.clientHeight)}`;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `responsivesnap-${host}-${size}-${stamp}.png`;
      document.documentElement.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 10000);

      if (ui === current) toast(`Screenshot saved \u00b7 ${sw}\u00d7${sh}`);
    } catch (error) {
      if (ui === current) {
        current.root.classList.remove('rs-capturing');
        toast(`Screenshot failed: ${error.message}`, 3500);
      }
    } finally {
      current.capturing = false;
    }
  }

  /* ------------------------------------------------------------------ *
   *  Toggle (driven by the toolbar icon via background.js)
   * ------------------------------------------------------------------ */

  async function open() {
    if (opening || document.getElementById(ROOT_ID)) return;
    opening = true;
    try {
      const stored = await loadStored();
      if (!document.getElementById(ROOT_ID)) mount(stored);
    } finally {
      opening = false;
    }
  }

  function toggle() {
    if (document.getElementById(ROOT_ID)) closeOverlay();
    else open();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message) return;
    if (message.type === TOGGLE_MESSAGE) toggle();
    else if (message.type === FRAME_MESSAGE) onFrameEvent(message);
  });
})();
