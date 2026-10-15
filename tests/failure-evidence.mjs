// What a failed browser scenario saw, so a deployment that had not reached the site yet can be told
// apart from a real defect (the first test:live after d9f41e7 failed and nothing was kept).
// Saved under artifacts/live-failure/<run time>/<scenario>/: the page's HTML and a screenshot, and a
// fresh request for origin + '/' made from Node — no browser cookies — with its body and a few response
// headers. Only the headers below are kept, so Set-Cookie and the like never reach the disk.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const KEPT_HEADERS = ['age', 'cache-control', 'cf-cache-status', 'cf-ray', 'content-type', 'date', 'etag', 'last-modified', 'server'];
const runTime = new Date().toISOString().replace(/[:.]/g, '-');

const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'scenario';

/** Saves what it can and returns the folder; a step that fails is noted in notes.txt instead of hiding the test's own error. */
export async function saveFailureEvidence({ name, page, origin, error, extra, root = resolve(import.meta.dirname, '..') }) {
  const dir = join(root, 'artifacts/live-failure', runTime, slug(name));
  await mkdir(dir, { recursive: true });
  const notes = [];
  const step = async (label, action) => { try { await action(); } catch (failure) { notes.push(`${label}: ${failure?.message ?? failure}`); } };
  await writeFile(join(dir, 'error.txt'), `scenario: ${name}\norigin: ${origin}\nTEST_LOCALE: ${process.env.TEST_LOCALE || ''}\nsaved: ${new Date().toISOString()}\n\n${error?.stack ?? error}\n`);
  await step('page url', async () => notes.push(`page url: ${page.url()}`));
  await step('page.content()', async () => writeFile(join(dir, 'page.html'), await page.content()));
  await step('screenshot', async () => { await page.screenshot({ path: join(dir, 'screenshot.png'), fullPage: true, timeout: 10000 }); });
  await step(`fetch ${origin}/`, async () => {
    const response = await fetch(origin + '/', { cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const headers = Object.fromEntries(KEPT_HEADERS.filter(key => response.headers.has(key)).map(key => [key, response.headers.get(key)]));
    await writeFile(join(dir, 'origin-response.json'), JSON.stringify({ url: origin + '/', status: response.status, fetchedAt: new Date().toISOString(), headers }, null, 2) + '\n');
    await writeFile(join(dir, 'origin-index.html'), await response.text());
  });
  // What the runner adds (focus, its last messages…): a function, run here so its own failure is noted too.
  if (extra) await step('extra', async () => writeFile(join(dir, 'extra.json'), JSON.stringify(await extra(), null, 2) + '\n'));
  await writeFile(join(dir, 'notes.txt'), notes.join('\n') + '\n');
  console.error(`Failure evidence for "${name}": ${dir}`);
  return dir;
}
