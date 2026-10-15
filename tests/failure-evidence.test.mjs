// tests/failure-evidence.mjs: what a failed browser scenario leaves in artifacts/live-failure/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveFailureEvidence } from './failure-evidence.mjs';

async function site() {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html', 'cf-ray': 'abc-ICN', age: '7', etag: '"v1"', 'set-cookie': 'session=secret-value', authorization: 'Bearer secret-token' });
    response.end('<p>served index</p>');
  });
  await new Promise(done => server.listen(0, 'localhost', done));
  return { server, origin: `http://localhost:${server.address().port}` };
}
const files = async dir => (await readdir(dir)).sort();

test('a failure keeps the page, a screenshot, and a fresh index request with only the listed headers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'failure-evidence-'));
  const { server, origin } = await site();
  try {
    const page = { url: () => origin + '/xlsx', content: async () => '<p>what the browser had</p>', screenshot: async ({ path }) => { await (await import('node:fs/promises')).writeFile(path, 'png'); } };
    const dir = await saveFailureEvidence({ name: 'clean URLs: the Excel view', page, origin, error: new Error('link not found'), root });
    assert.match(dir, /artifacts\/live-failure\/[^/]+\/clean-urls-the-excel-view$/);
    assert.deepEqual(await files(dir), ['error.txt', 'notes.txt', 'origin-index.html', 'origin-response.json', 'page.html', 'screenshot.png']);
    assert.equal(await readFile(join(dir, 'page.html'), 'utf8'), '<p>what the browser had</p>');
    assert.equal(await readFile(join(dir, 'origin-index.html'), 'utf8'), '<p>served index</p>');
    const response = JSON.parse(await readFile(join(dir, 'origin-response.json'), 'utf8'));
    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(response.headers).sort(), ['age', 'cf-ray', 'content-type', 'date', 'etag']);
    assert.equal(response.headers['cf-ray'], 'abc-ICN');
    const everything = (await Promise.all((await files(dir)).map(name => readFile(join(dir, name), 'utf8')))).join('\n');
    assert.doesNotMatch(everything, /secret-value|secret-token/);
    assert.match(await readFile(join(dir, 'error.txt'), 'utf8'), /link not found/);
    assert.match(await readFile(join(dir, 'notes.txt'), 'utf8'), /page url: .*\/xlsx/);
  } finally { server.close(); await rm(root, { recursive: true, force: true }); }
});

test('a step that cannot run is noted and the rest is still saved', async () => {
  const root = await mkdtemp(join(tmpdir(), 'failure-evidence-'));
  const { server, origin } = await site();
  try {
    const page = { url: () => 'about:blank', content: async () => { throw new Error('Target page has been closed'); }, screenshot: async () => { throw new Error('no screenshot'); } };
    const dir = await saveFailureEvidence({ name: 'x', page, origin, error: new Error('boom'), root });
    assert.deepEqual(await files(dir), ['error.txt', 'notes.txt', 'origin-index.html', 'origin-response.json']);
    const notes = await readFile(join(dir, 'notes.txt'), 'utf8');
    assert.match(notes, /page.content\(\): Target page has been closed/);
    assert.match(notes, /screenshot: no screenshot/);
    // An origin that does not answer is noted too.
    const dir2 = await saveFailureEvidence({ name: 'y', page, origin: 'http://localhost:9', error: new Error('boom'), root });
    assert.match(await readFile(join(dir2, 'notes.txt'), 'utf8'), /fetch http:\/\/localhost:9\/: /);
  } finally { server.close(); await rm(root, { recursive: true, force: true }); }
});
