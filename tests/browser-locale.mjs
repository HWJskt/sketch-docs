// TEST_LOCALE (e.g. en-US) runs the browser tests as a Chrome in that language, the way GitHub's
// English runners did when they caught 4aec08c. Scenarios that fix their own `locale` keep it.
import assert from 'node:assert/strict';

export const testLocale = process.env.TEST_LOCALE || '';
/** Options for chromium.launch / launchPersistentContext (the UI language; headless Chrome on macOS ignores it). */
export const launchArgs = testLocale ? { args: [`--lang=${testLocale}`] } : {};
/** Options for every new context or page that does not choose its own locale: this is what sets navigator.language. */
export const contextLocale = testLocale ? { locale: testLocale } : {};
/** Fails unless a page without its own locale really reports TEST_LOCALE, so the run is not silently Korean. */
export async function assertTestLocale(page) {
  if (!testLocale) return;
  assert.equal(await page.evaluate(() => navigator.language), testLocale, 'TEST_LOCALE did not reach the browser');
}
