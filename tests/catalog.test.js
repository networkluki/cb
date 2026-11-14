import test from 'node:test';
import assert from 'node:assert/strict';
import {CatalogError, encodedPath, filterEntries, parseCatalog, readLimitedText, validatePath} from '../assets/catalog.js';

const entry = (overrides = {}) => ({
  path: '/nlpy/network_check.py', title: 'Network check', description: '',
  language: 'Python', platforms: [], kind: 'script', tags: [], requirements: '',
  usage: '', verification: '', license: '', updated: '', ...overrides,
});
const catalog = entries => ({schemaVersion: 1, entries});
const filters = overrides => ({query: '', kind: 'all', language: 'all', platform: 'all', sort: 'title', ...overrides});

test('an empty repository produces an empty catalog', () => {
  assert.deepEqual(parseCatalog(catalog([])), []);
});

test('source metadata never invents a platform, license, or verification', () => {
  const [item] = parseCatalog(catalog([entry()]));
  assert.deepEqual(item.platforms, []);
  assert.equal(item.verification, '');
  assert.equal(item.license, '');
  assert.equal(item.updated, '');
  assert.ok(Object.isFrozen(item));
  assert.ok(Object.isFrozen(item.platforms));
});

test('only supported source folders and extensions can become request paths', () => {
  for (const path of [
    '//example.com/evil.py', '/nlpy/../private.py', '/nlpy/%2e%2e/x.py',
    '/nlpy/a\\b.py', '/nlpy/a.py?token=x', '/nlpy/a.py#x', '/nlpy/.hidden.py',
    '/nlpy/x.php', '/assets/x.py', '/nlps/x.py', '/nlpy//x.py',
    '/nlpy/' + 'x'.repeat(129) + '.py',
  ]) assert.throws(() => validatePath(path), CatalogError, path);
  assert.equal(validatePath('/nlsh/tools/status.sh').language, 'Shell');
  assert.equal(validatePath('/nlsh/tools/status.bash').language, 'Bash');
  assert.equal(validatePath('/nlps/status.ps1').language, 'PowerShell');
  assert.equal(encodedPath('/nlpy/check tls.py'), '/nlpy/check%20tls.py');
});

test('schema, prototype-related keys, duplicates, and bad metadata fail closed', () => {
  assert.throws(() => parseCatalog({schemaVersion: 2, entries: []}), CatalogError);
  assert.throws(() => parseCatalog(JSON.parse('{"schemaVersion":1,"entries":[],"__proto__":{}}')), CatalogError);
  assert.throws(() => parseCatalog(catalog([entry(), entry()])), CatalogError);
  assert.throws(() => parseCatalog(catalog([entry({platforms: 'Linux'})])), CatalogError);
  assert.throws(() => parseCatalog(catalog([entry({title: 'x'.repeat(161)})])), CatalogError);
  assert.throws(() => parseCatalog(catalog([entry({language: 'Bash'})])), CatalogError);
  assert.throws(() => parseCatalog(catalog([entry({kind: 'executable'})])), CatalogError);
});

test('dates must be real calendar dates in a deterministic format', () => {
  for (const updated of ['2026-02-30', '14/11/2026', 'yesterday']) {
    assert.throws(() => parseCatalog(catalog([entry({updated})])), CatalogError);
  }
  assert.equal(parseCatalog(catalog([entry({updated: '2024-02-29'})]))[0].updated, '2024-02-29');
});

test('markup remains literal metadata and code remains unmodified text', async () => {
  const unsafe = '<img src=x onerror="alert(1)">';
  const [item] = parseCatalog(catalog([entry({title: unsafe})]));
  assert.equal(item.title, unsafe);
  assert.equal(await readLimitedText(new Response('</script>\n' + unsafe), 1024), '</script>\n' + unsafe);
});

test('filters combine type, language, platform and all search terms', () => {
  const items = parseCatalog(catalog([
    entry({title: 'TLS checker', tags: ['network'], platforms: ['Linux']}),
    entry({path: '/nlps/status.ps1', title: 'Services', language: 'PowerShell', platforms: ['Windows'], kind: 'snippet'}),
  ]));
  assert.equal(filterEntries(items, filters({query: 'TLS network', platform: 'Linux'})).length, 1);
  assert.equal(filterEntries(items, filters({query: 'TLS missing'})).length, 0);
  assert.equal(filterEntries(items, filters({kind: 'snippet', language: 'PowerShell', platform: 'Windows'}))[0].title, 'Services');
  assert.equal(filterEntries(items, filters({platform: 'macOS'})).length, 0);
});

test('recently updated sorts known dates first without mutating source order', () => {
  const items = parseCatalog(catalog([
    entry({title: 'Unknown'}),
    entry({path: '/nlpy/old.py', title: 'Old', updated: '2026-01-01'}),
    entry({path: '/nlpy/new.py', title: 'New', updated: '2026-11-14'}),
  ]));
  assert.deepEqual(filterEntries(items, filters({sort: 'updated'})).map(item => item.title), ['New', 'Old', 'Unknown']);
  assert.equal(items[0].title, 'Unknown');
});

test('declared oversized responses are rejected before reading', async () => {
  await assert.rejects(readLimitedText(new Response('x', {headers: {'content-length': '500'}}), 10), {code: 'SIZE_LIMIT'});
});

test('streamed content cannot evade the byte limit by omitting its length', async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(6));
      controller.enqueue(new Uint8Array(6));
      controller.close();
    },
  });
  await assert.rejects(readLimitedText(new Response(body), 10), {code: 'SIZE_LIMIT'});
});

test('UTF-8 split across chunks is decoded correctly', async () => {
  const bytes = new TextEncoder().encode('åäö\n');
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, 1));
      controller.enqueue(bytes.slice(1));
      controller.close();
    },
  });
  assert.equal(await readLimitedText(new Response(body), 100), 'åäö\n');
});

test('binary and malformed UTF-8 sources are not previewed', async () => {
  await assert.rejects(readLimitedText(new Response('a\u0000b'), 100), {code: 'BINARY_FILE'});
  await assert.rejects(readLimitedText(new Response(new Uint8Array([255, 255])), 100), TypeError);
});
