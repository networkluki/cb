/**
 * BROWSER: public, read-only CodeBase catalog UI. No credentials are shipped.
 * @version 1.0.0
 * CHANGELOG: 1.0.0 — Add search, filters, source previews, sharing, and themes.
 */
import {CatalogError, LIMITS, encodedPath, filterEntries, parseCatalog, readLimitedText} from './catalog.js';

/** @typedef {import('./catalog.js').Entry} Entry */

/** @param {string} event @param {unknown} error @returns {void} */
function report(event, error) {
  console.error(JSON.stringify({
    level: 'error', event,
    code: error instanceof CatalogError ? error.code : 'OPERATION_FAILED',
  }));
}

/**
 * Resolve an integration element and fail clearly on an incomplete page.
 * @template {HTMLElement} T
 * @param {string} id
 * @param {{new (...args: any[]): T}} type
 * @returns {T}
 */
function required(id, type) {
  const node = document.getElementById(id);
  if (!(node instanceof type)) throw new CatalogError('Missing page element: ' + id, 'INVALID_PAGE');
  return node;
}

/**
 * Fetch only the current origin, with bounded reads, no credentials or redirects.
 * Browser checks protect the preview; publishing access remains controlled by GitHub.
 * @param {URL} url @param {number} maximum @param {AbortSignal} parentSignal
 * @returns {Promise<string>}
 */
async function fetchText(url, maximum, parentSignal) {
  if (url.origin !== window.location.origin || !['http:', 'https:'].includes(url.protocol)) {
    throw new CatalogError('Only same-origin files may be loaded.', 'INVALID_ORIGIN');
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  parentSignal.addEventListener('abort', abort, {once: true});
  if (parentSignal.aborted) controller.abort();
  const timeout = window.setTimeout(abort, LIMITS.timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal, credentials: 'omit', redirect: 'error',
      cache: 'no-cache', referrerPolicy: 'no-referrer',
    });
    if (!response.ok) throw new CatalogError('The requested file could not be loaded.', 'HTTP_ERROR');
    return await readLimitedText(response, maximum);
  } finally {
    window.clearTimeout(timeout);
    parentSignal.removeEventListener('abort', abort);
  }
}

/**
 * Add basic lexical color without interpreting source text as HTML or JavaScript.
 * Large files remain plain text to keep the preview responsive.
 * @param {HTMLElement} target @param {string} text @returns {void}
 */
function highlight(target, text) {
  target.replaceChildren();
  if (text.length > 60000) { target.textContent = text; return; }
  const pattern = /#[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b(?:import|from|def|class|return|if|elif|else|for|while|in|try|except|finally|with|as|raise|function|param|foreach|switch|break|continue|then|fi|do|done|case|esac|export|local|True|False|None|null|true|false)\b|\b\d+(?:\.\d+)?\b/gu;
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  let tokens = 0;
  for (const match of text.matchAll(pattern)) {
    if (++tokens > 12000) { target.textContent = text; return; }
    const position = match.index;
    fragment.append(document.createTextNode(text.slice(cursor, position)));
    const token = document.createElement('span');
    const value = match[0];
    token.className = value.startsWith('#') ? 'token-comment'
      : (value.startsWith('"') || value.startsWith("'")) ? 'token-string'
      : /^[0-9]/u.test(value) ? 'token-number' : 'token-keyword';
    token.textContent = value;
    fragment.append(token);
    cursor = position + value.length;
  }
  fragment.append(document.createTextNode(text.slice(cursor)));
  target.append(fragment);
}

/** @returns {void} */
function start() {
  const search = required('search-input', HTMLInputElement);
  const language = required('language-filter', HTMLSelectElement);
  const platform = required('platform-filter', HTMLSelectElement);
  const sort = required('sort-select', HTMLSelectElement);
  const theme = required('theme-select', HTMLSelectElement);
  const list = required('catalog-list', HTMLElement);
  const count = required('result-count', HTMLElement);
  const loading = required('loading-state', HTMLElement);
  const loadError = required('load-error', HTMLElement);
  const empty = required('empty-state', HTMLElement);
  const emptyTitle = required('empty-title', HTMLElement);
  const emptyDescription = required('empty-description', HTMLElement);
  const reset = required('reset-filters', HTMLButtonElement);
  const detail = required('detail-panel', HTMLElement);
  const placeholder = required('detail-placeholder', HTMLElement);
  const title = required('detail-title', HTMLElement);
  const description = required('detail-description', HTMLElement);
  const tags = required('detail-tags', HTMLElement);
  const filename = required('detail-filename', HTMLElement);
  const code = required('code-block', HTMLElement);
  const codeStatus = required('code-status', HTMLElement);
  const copy = required('copy-code', HTMLButtonElement);
  const download = required('download-code', HTMLAnchorElement);
  const sourceLink = required('source-link', HTMLAnchorElement);
  const share = required('share-entry', HTMLButtonElement);
  const actionStatus = required('action-status', HTMLElement);
  const requirements = required('detail-requirements', HTMLElement);
  const usage = required('detail-usage', HTMLElement);
  const verification = required('detail-verification', HTMLElement);
  const license = required('detail-license', HTMLElement);
  const updated = required('detail-updated', HTMLElement);
  const aboutToggle = required('about-toggle', HTMLButtonElement);
  const aboutPanel = required('about-panel', HTMLElement);
  const typeButtons = Array.from(required('type-filters', HTMLElement).querySelectorAll('button'));
  /** @type {readonly Entry[]} */
  let entries = [];
  let ready = false;
  let kind = 'all';
  /** @type {string|null} */
  let selectedPath = null;
  /** @type {string|null} */
  let displayedPath = null;
  /** @type {string|null} */
  let currentCode = null;
  let catalogRequest = new AbortController();
  let codeRequest = new AbortController();
  const cache = new Map();
  const sourceBase = 'https://github.com/networkluki/cb/blob/main';

  /** @param {HTMLElement} target @param {string} text @param {boolean} [isLanguage] */
  function addTag(target, text, isLanguage = false) {
    const tag = document.createElement('span');
    tag.className = isLanguage ? 'tag tag-language' : 'tag';
    tag.textContent = text;
    target.append(tag);
  }

  /** @param {HTMLElement} target @param {Entry} entry */
  function entryTags(target, entry) {
    addTag(target, entry.language, true);
    addTag(target, entry.kind === 'script' ? 'Script' : 'Snippet');
    entry.platforms.forEach(label => addTag(target, label));
  }

  /** @param {string} path @returns {URL} */
  function entryURL(path) {
    const url = new URL(window.location.href);
    url.hash = new URLSearchParams({entry: path}).toString();
    return url;
  }

  /** @returns {string|null} */
  function requestedEntry() {
    if (window.location.hash.length > 1600) return null;
    return new URLSearchParams(window.location.hash.slice(1)).get('entry');
  }

  /** @param {Entry} entry @returns {Promise<void>} */
  async function loadCode(entry) {
    codeRequest.abort();
    codeRequest = new AbortController();
    const request = codeRequest;
    copy.disabled = true;
    currentCode = null;
    code.textContent = '';
    codeStatus.textContent = 'Loading source…';
    try {
      let text = cache.get(entry.path);
      if (typeof text !== 'string') {
        text = await fetchText(new URL(encodedPath(entry.path), window.location.origin), LIMITS.previewBytes, request.signal);
        if (cache.size >= 8) cache.delete(cache.keys().next().value);
        cache.set(entry.path, text);
      }
      if (request.signal.aborted || displayedPath !== entry.path) return;
      currentCode = text;
      highlight(code, text);
      copy.disabled = text.length === 0;
      codeStatus.textContent = text.length ? 'Source preview · ' + entry.language : 'This file is empty.';
    } catch (error) {
      if (request.signal.aborted) return;
      codeStatus.textContent = error instanceof CatalogError && error.code === 'SIZE_LIMIT'
        ? 'This file is larger than the 256 KiB preview limit. Download it or view the source on GitHub.'
        : 'The source could not be previewed. Download the file or view it on GitHub.';
      report('source_preview', error);
    }
  }

  /** @param {Entry|null} entry @param {boolean} [writeURL] @returns {void} */
  function selectEntry(entry, writeURL = false) {
    selectedPath = entry ? entry.path : null;
    detail.hidden = !entry;
    placeholder.hidden = Boolean(entry);
    if (!entry) {
      codeRequest.abort(); displayedPath = null; currentCode = null; return;
    }
    for (const button of list.querySelectorAll('button')) {
      const selected = button.dataset.path === entry.path;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('is-selected', selected);
    }
    if (writeURL) window.history.replaceState(null, '', entryURL(entry.path));
    if (displayedPath === entry.path) return;
    displayedPath = entry.path;
    title.textContent = entry.title;
    description.textContent = entry.description || 'No description has been added for this file yet.';
    tags.replaceChildren();
    entryTags(tags, entry);
    entry.tags.forEach(label => addTag(tags, label));
    filename.textContent = entry.path.slice(1);
    requirements.textContent = entry.requirements || 'Requirements have not been documented yet.';
    usage.textContent = entry.usage || 'Usage instructions have not been added yet. Read the source before using this file.';
    verification.textContent = entry.verification || 'No verification information provided.';
    license.textContent = entry.license || 'Not specified.';
    updated.textContent = entry.updated
      ? new Intl.DateTimeFormat('en', {dateStyle: 'medium', timeZone: 'UTC'}).format(new Date(entry.updated + 'T00:00:00Z'))
      : 'Not specified.';
    download.href = encodedPath(entry.path);
    download.download = entry.path.split('/').pop() || 'source.txt';
    sourceLink.href = sourceBase + encodedPath(entry.path);
    actionStatus.textContent = '';
    void loadCode(entry);
  }

  /** @returns {void} */
  function render() {
    if (!ready) return;
    const visible = filterEntries(entries, {query: search.value, kind, language: language.value, platform: platform.value, sort: sort.value});
    list.replaceChildren();
    count.textContent = visible.length + ' of ' + entries.length + ' published ' + (entries.length === 1 ? 'entry' : 'entries');
    empty.hidden = visible.length > 0;
    reset.hidden = entries.length === 0;
    emptyTitle.textContent = entries.length ? 'No matching code found.' : 'The collection starts here.';
    emptyDescription.textContent = entries.length
      ? 'Try another search term or clear the filters.'
      : 'New scripts and snippets will appear here as they are published.';
    for (const entry of visible) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'entry-card';
      button.dataset.path = entry.path;
      button.setAttribute('aria-controls', 'detail-panel');
      button.setAttribute('aria-pressed', 'false');
      const heading = document.createElement('span');
      heading.className = 'entry-heading';
      const name = document.createElement('span');
      name.className = 'entry-title';
      name.textContent = entry.title;
      const arrow = document.createElement('span');
      arrow.className = 'entry-arrow';
      arrow.textContent = '→';
      arrow.setAttribute('aria-hidden', 'true');
      heading.append(name, arrow);
      const summary = document.createElement('span');
      summary.className = 'entry-description';
      summary.textContent = entry.description || entry.path.slice(1);
      const labels = document.createElement('span');
      labels.className = 'entry-tags';
      entryTags(labels, entry);
      button.append(heading, summary, labels);
      button.addEventListener('click', () => selectEntry(entry, true));
      list.append(button);
    }
    selectEntry(visible.find(entry => entry.path === selectedPath) || visible[0] || null);
  }

  /** @param {HTMLSelectElement} target @param {string} label @param {string[]} values */
  function populateSelect(target, label, values) {
    const previous = target.value;
    target.replaceChildren(new Option(label, 'all'));
    Array.from(new Set(values)).sort().forEach(value => target.append(new Option(value, value)));
    target.value = Array.from(target.options).some(option => option.value === previous) ? previous : 'all';
  }

  /** @returns {Promise<void>} */
  async function loadCatalog() {
    catalogRequest.abort();
    catalogRequest = new AbortController();
    const request = catalogRequest;
    ready = false;
    codeRequest.abort();
    loading.hidden = false; loadError.hidden = true; empty.hidden = true;
    detail.hidden = true; placeholder.hidden = false;
    list.replaceChildren();
    count.textContent = 'Loading collection…';
    try {
      const text = await fetchText(new URL('/catalog.json', window.location.origin), LIMITS.catalogBytes, request.signal);
      const data = parseCatalog(JSON.parse(text));
      if (request.signal.aborted) return;
      entries = data;
      ready = true;
      cache.clear(); displayedPath = null;
      selectedPath = requestedEntry();
      populateSelect(language, 'All languages', entries.map(entry => entry.language));
      populateSelect(platform, 'All platforms', entries.flatMap(entry => [...entry.platforms]));
      loading.hidden = true;
      render();
    } catch (error) {
      if (request.signal.aborted) return;
      entries = []; selectedPath = null; displayedPath = null; currentCode = null;
      loading.hidden = true; loadError.hidden = false;
      count.textContent = 'Collection unavailable';
      report('catalog_load', error);
    }
  }

  /** @returns {void} */
  function resetFilters() {
    search.value = ''; language.value = 'all'; platform.value = 'all'; kind = 'all';
    typeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.kind === 'all')));
  }

  /** @param {string} text @param {string} success @returns {Promise<void>} */
  async function copyText(text, success) {
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new CatalogError('Clipboard is unavailable.', 'CLIPBOARD_UNAVAILABLE');
      await navigator.clipboard.writeText(text);
      actionStatus.textContent = success;
    } catch (error) {
      actionStatus.textContent = 'Automatic copying is unavailable. Select and copy the text manually.';
      report('clipboard_write', error);
    }
  }

  search.addEventListener('input', render);
  language.addEventListener('change', render);
  platform.addEventListener('change', render);
  sort.addEventListener('change', render);
  typeButtons.forEach(button => button.addEventListener('click', () => {
    const next = button.dataset.kind;
    if (next !== 'all' && next !== 'script' && next !== 'snippet') return;
    kind = next;
    typeButtons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    render();
  }));
  reset.addEventListener('click', () => {resetFilters(); render(); search.focus();});
  required('retry-load', HTMLButtonElement).addEventListener('click', () => {void loadCatalog();});
  copy.addEventListener('click', () => {if (currentCode !== null) void copyText(currentCode, 'Source code copied.');});
  share.addEventListener('click', () => {if (selectedPath) void copyText(entryURL(selectedPath).href, 'Entry link copied.');});
  aboutToggle.addEventListener('click', () => {
    aboutPanel.hidden = !aboutPanel.hidden;
    aboutToggle.setAttribute('aria-expanded', String(!aboutPanel.hidden));
  });
  window.addEventListener('hashchange', () => {
    const path = requestedEntry();
    if (!path || !entries.some(entry => entry.path === path)) return;
    resetFilters(); selectedPath = path; render();
  });

  /** @param {string} value @returns {void} */
  function applyTheme(value) {
    if (value === 'light' || value === 'dark') document.documentElement.dataset.theme = value;
    else delete document.documentElement.dataset.theme;
  }
  try {
    const saved = localStorage.getItem('codebase-theme');
    if (saved === 'light' || saved === 'dark' || saved === 'system') theme.value = saved;
  } catch (error) { report('theme_read', error); }
  applyTheme(theme.value);
  theme.addEventListener('change', () => {
    applyTheme(theme.value);
    try {localStorage.setItem('codebase-theme', theme.value);}
    catch (error) {report('theme_write', error);}
  });
  void loadCatalog();
}

try { start(); }
catch (error) {
  report('page_start', error);
  const failure = document.getElementById('load-error');
  const loading = document.getElementById('loading-state');
  if (failure) failure.hidden = false;
  if (loading) loading.hidden = true;
}
