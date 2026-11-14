/**
 * BROWSER: validated, immutable catalog data and bounded source-file reads.
 * @version 1.0.0
 * CHANGELOG: 1.0.0 — Add catalog validation, filtering, sorting, and read limits.
 */

/**
 * @typedef {Readonly<{
 *   path: string, title: string, description: string, language: string,
 *   platforms: readonly string[], kind: 'script'|'snippet', tags: readonly string[],
 *   requirements: string, usage: string, verification: string, license: string,
 *   updated: string
 * }>} Entry
 */

/**
 * @typedef {{query: string, kind: string, language: string,
 *   platform: string, sort: string}} Filters
 */

export const LIMITS = Object.freeze({
  catalogBytes: 2 * 1024 * 1024,
  previewBytes: 256 * 1024,
  entries: 5000,
  timeoutMs: 12000,
});

/** A catalog or content-validation failure with a stable reason code. */
export class CatalogError extends Error {
  /** @param {string} message @param {string} code */
  constructor(message, code = 'INVALID_CATALOG') {
    super(message);
    this.name = 'CatalogError';
    this.code = code;
  }
}

/**
 * Require a record without special prototype-related keys.
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function record(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new CatalogError('Expected a catalog object.');
  }
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw new CatalogError('Unsupported object key.');
    }
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * Validate a plain-text metadata value without interpreting markup.
 * @param {unknown} value @param {number} maximum
 * @param {string} [fallback]
 * @returns {string}
 */
function plainText(value, maximum, fallback = '') {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new CatalogError('Invalid metadata text or length.');
  }
  return value.trim();
}

/** @param {unknown} value @returns {readonly string[]} */
function textList(value) {
  if (value === undefined || value === null) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > 20) throw new CatalogError('Invalid metadata list.');
  const items = value.map(item => plainText(item, 64));
  if (items.some(item => item.length === 0)) throw new CatalogError('Empty metadata label.');
  return Object.freeze(Array.from(new Set(items)));
}

/**
 * Restrict previews and downloads to supported source files in collection folders.
 * @param {unknown} value
 * @returns {{path: string, language: string}}
 */
export function validatePath(value) {
  if (typeof value !== 'string' || value.length > 512 || !value.startsWith('/')) {
    throw new CatalogError('Invalid source-file path.');
  }
  const segments = value.slice(1).split('/');
  if (segments.length < 2 || segments.some(segment => segment.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._ -]*$/u.test(segment))) {
    throw new CatalogError('Source-file path contains unsupported segments.');
  }
  const folder = segments[0];
  const filename = segments[segments.length - 1];
  const extension = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  let language;
  if (folder === 'nlpy' && extension === '.py') language = 'Python';
  else if (folder === 'nlps' && extension === '.ps1') language = 'PowerShell';
  else if (folder === 'nlsh' && extension === '.sh') language = 'Shell';
  else if (folder === 'nlsh' && extension === '.bash') language = 'Bash';
  else throw new CatalogError('Unsupported folder or source-file extension.');
  return {path: value, language};
}

/**
 * Parse catalog data into an explicit immutable schema.
 * @param {unknown} input
 * @returns {readonly Entry[]}
 */
export function parseCatalog(input) {
  const catalog = record(input);
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.entries) || catalog.entries.length > LIMITS.entries) {
    throw new CatalogError('Unsupported catalog schema or size.');
  }
  const paths = new Set();
  return Object.freeze(catalog.entries.map(raw => {
    const item = record(raw);
    const source = validatePath(item.path);
    if (paths.has(source.path)) throw new CatalogError('Duplicate source-file path.');
    paths.add(source.path);
    if (item.language !== source.language) throw new CatalogError('Source language does not match its folder.');
    const kind = item.kind === undefined ? 'script' : item.kind;
    if (kind !== 'script' && kind !== 'snippet') throw new CatalogError('Unsupported content type.');
    const updated = plainText(item.updated, 10);
    if (updated) {
      const date = new Date(updated + 'T00:00:00Z');
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(updated) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== updated) {
        throw new CatalogError('Updated date must be a real YYYY-MM-DD date.');
      }
    }
    const filename = source.path.split('/').pop() || source.path;
    return Object.freeze({
      path: source.path,
      title: plainText(item.title, 160, filename) || filename,
      description: plainText(item.description, 1000),
      language: source.language,
      platforms: textList(item.platforms),
      kind,
      tags: textList(item.tags),
      requirements: plainText(item.requirements, 8000),
      usage: plainText(item.usage, 8000),
      verification: plainText(item.verification, 8000),
      license: plainText(item.license, 160),
      updated,
    });
  }));
}

/**
 * Search and filter a catalog without changing the original order or entries.
 * @param {readonly Entry[]} entries @param {Filters} filters
 * @returns {Entry[]}
 */
export function filterEntries(entries, filters) {
  const words = filters.query.slice(0, 256).trim().toLocaleLowerCase('en').split(/\s+/u).filter(Boolean);
  const results = entries.filter(entry => {
    const searchable = [entry.title, entry.description, entry.path, entry.language, ...entry.tags].join(' ').toLocaleLowerCase('en');
    return (filters.kind === 'all' || entry.kind === filters.kind)
      && (filters.language === 'all' || entry.language === filters.language)
      && (filters.platform === 'all' || entry.platforms.includes(filters.platform))
      && words.every(word => searchable.includes(word));
  });
  const collator = new Intl.Collator('en', {sensitivity: 'base', numeric: true});
  return results.sort((left, right) => {
    if (filters.sort === 'updated' && left.updated !== right.updated) {
      return right.updated.localeCompare(left.updated);
    }
    return collator.compare(left.title, right.title) || collator.compare(left.path, right.path);
  });
}

/**
 * Encode validated path segments without allowing a new host, query, or fragment.
 * @param {string} path
 * @returns {string}
 */
export function encodedPath(path) {
  validatePath(path);
  return path.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

/**
 * Decode a response incrementally, enforcing the byte limit before retaining data.
 * @param {Response} response @param {number} maximum
 * @returns {Promise<string>}
 */
export async function readLimitedText(response, maximum) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximum) {
    if (response.body) await response.body.cancel();
    throw new CatalogError('The file exceeds the preview limit.', 'SIZE_LIMIT');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', {fatal: true});
  const parts = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maximum) throw new CatalogError('The file exceeds the preview limit.', 'SIZE_LIMIT');
      parts.push(decoder.decode(next.value, {stream: true}));
    }
    parts.push(decoder.decode());
    const text = parts.join('');
    if (text.includes('\u0000')) throw new CatalogError('Binary content cannot be previewed.', 'BINARY_FILE');
    return text;
  } finally {
    try { await reader.cancel(); }
    finally { reader.releaseLock(); }
  }
}
