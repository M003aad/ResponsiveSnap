/**
 * ResponsiveSnap – background service worker
 *
 * There is no popup: clicking the toolbar icon sends a "toggle" message to the
 * content script in the active tab, which opens or closes the device preview.
 *
 * The worker also:
 *   - watches the preview iframe's navigations (chrome.webNavigation) so the
 *     content script can show real "loading / loaded / failed" states, even
 *     for cross-origin pages it cannot inspect;
 *   - captures the visible tab for the screenshot export.
 */

const TOGGLE_MESSAGE = 'RESPONSIVESNAP_TOGGLE';
const FRAME_MESSAGE = 'RESPONSIVESNAP_FRAME';
const WATCH_KEY = 'rsWatch';

/* ------------------------------------------------------------------ *
 *  Toolbar icon → toggle
 * ------------------------------------------------------------------ */

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || tab.id === undefined) return;

  try {
    // frameId 0 = the top frame only (the preview iframe never gets the UI).
    await chrome.tabs.sendMessage(tab.id, { type: TOGGLE_MESSAGE }, { frameId: 0 });
  } catch (_) {
    // No listener yet: the tab was already open when the extension was
    // installed / reloaded. Inject the content script by hand, then retry.
    try {
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content.css'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tab.id, { type: TOGGLE_MESSAGE }, { frameId: 0 });
    } catch (error) {
      // chrome:// pages, the Chrome Web Store, the PDF viewer, etc. can't be scripted.
      flashBadge(tab.id);
    }
  }
});

/** Briefly shows a red "!" on the toolbar icon to signal "can't run on this page". */
function flashBadge(tabId) {
  const ignore = () => {};
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#dc2626' }).catch(ignore);
  chrome.action.setBadgeText({ tabId, text: '!' }).catch(ignore);
  setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }).catch(ignore), 2000);
}

/* ------------------------------------------------------------------ *
 *  Preview-frame watching
 *
 *  watch = { [tabId]: { url, frameId } }
 *  The content script announces which URL it is about to load; the first
 *  sub-frame navigation to that URL is "our" iframe, and its frameId is
 *  remembered. The map lives in storage.session so it survives the service
 *  worker being suspended between events.
 * ------------------------------------------------------------------ */

let watch = null;

async function getWatch() {
  if (!watch) {
    try {
      const data = await chrome.storage.session.get(WATCH_KEY);
      watch = data[WATCH_KEY] || {};
    } catch (_) {
      watch = {};
    }
  }
  return watch;
}

function persistWatch() {
  chrome.storage.session.set({ [WATCH_KEY]: watch }).catch(() => {});
}

function sameUrl(a, b) {
  try {
    return new URL(a).href === new URL(b).href;
  } catch (_) {
    return a === b;
  }
}

function notify(tabId, payload) {
  chrome.tabs
    .sendMessage(tabId, { type: FRAME_MESSAGE, ...payload }, { frameId: 0 })
    .catch(() => {});
}

async function track(details, phase) {
  if (details.frameId === 0) return;
  const map = await getWatch();
  const entry = map[details.tabId];
  if (!entry) return;

  if (entry.frameId == null) {
    // Not identified yet: adopt the first sub-frame that starts loading our URL.
    if (phase === 'loading' && sameUrl(details.url, entry.url)) {
      entry.frameId = details.frameId;
      persistWatch();
    } else {
      return;
    }
  }
  if (entry.frameId !== details.frameId) return;

  notify(details.tabId, { phase, url: details.url, error: details.error });
}

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId === 0) {
    // The page itself is navigating away – the overlay dies with it.
    const map = await getWatch();
    if (map[details.tabId]) {
      delete map[details.tabId];
      persistWatch();
    }
    return;
  }
  track(details, 'loading');
});
chrome.webNavigation.onCompleted.addListener((details) => track(details, 'done'));
chrome.webNavigation.onErrorOccurred.addListener((details) => track(details, 'error'));

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const map = await getWatch();
  if (map[tabId]) {
    delete map[tabId];
    persistWatch();
  }
});

/* ------------------------------------------------------------------ *
 *  Messages from the content script
 * ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !sender.tab) return false;
  const tabId = sender.tab.id;

  switch (message.type) {
    case 'RS_WATCH':
      getWatch().then((map) => {
        map[tabId] = { url: String(message.url), frameId: null };
        persistWatch();
        sendResponse({ ok: true });
      });
      return true;

    case 'RS_UNWATCH':
      getWatch().then((map) => {
        delete map[tabId];
        persistWatch();
        sendResponse({ ok: true });
      });
      return true;

    case 'RS_CAPTURE':
      chrome.tabs
        .captureVisibleTab(sender.tab.windowId, { format: 'png' })
        .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
        .catch((error) =>
          sendResponse({ ok: false, error: (error && error.message) || String(error) })
        );
      return true;

    default:
      return false;
  }
});
