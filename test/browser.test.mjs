import assert from 'node:assert/strict';
import { access, constants } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { startPreview } from '../src/server.mjs';

async function browserExecutable(t) {
  const explicit = process.env.MDSCOPE_CHROMIUM;
  const candidates = explicit !== undefined ? [explicit] : [chromium.executablePath(), '/usr/bin/chromium'];
  for (const path of candidates) {
    try { await access(path, constants.X_OK); return path; } catch (error) {
      if (explicit !== undefined || !['ENOENT', 'EACCES'].includes(error.code)) throw error;
    }
  }
  t.skip('No Playwright Chromium or /usr/bin/chromium executable found');
  return null;
}

test('Mermaid inspector renders locally and handles zoom, pan, theme, errors and replacement', async (t) => {
  const executablePath = await browserExecutable(t);
  if (!executablePath) return;
  const preview = await startPreview({ content: '```mermaid\nflowchart LR\n A --> B\n```' });
  const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.goto(preview.url);
    await page.locator('#document svg').waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Expand diagram' }).click();
    const dialog = page.getByRole('dialog', { name: 'Diagram inspector' });
    await dialog.waitFor();
    assert.equal(await dialog.locator('svg').count(), 1);
    assert.equal(await page.locator('svg').count(), 1, 'SVG moves instead of cloning IDs');
    const computed = () => dialog.locator('svg').evaluate(svg => {
      const style = getComputedStyle(svg);
      const node = svg.querySelector('.node rect, .node polygon, .node circle');
      const edge = svg.querySelector('.edgePath path, .flowchart-link');
      return { transform: style.transform, nodeFill: node && getComputedStyle(node).fill,
        edgeStroke: edge && getComputedStyle(edge).stroke, bounds: svg.getBoundingClientRect().toJSON(),
        viewport: document.getElementById('diagram-viewport').getBoundingClientRect().toJSON() };
    });
    const initial = await computed();
    assert.notEqual(initial.nodeFill, 'none');
    assert.notEqual(initial.edgeStroke, 'none');
    await page.getByRole('button', { name: 'Zoom in' }).click();
    assert.notEqual((await computed()).transform, initial.transform);
    await page.getByRole('button', { name: 'Zoom out' }).click();
    assert.equal((await computed()).transform, initial.transform);
    await page.getByRole('button', { name: 'Reset zoom' }).click();
    assert.equal((await computed()).transform, initial.transform);
    await dialog.locator('svg').dispatchEvent('wheel', { deltaY: -120 });
    assert.notEqual((await computed()).transform, initial.transform);
    await page.getByRole('button', { name: 'Fit diagram' }).click();
    const fit = await computed();
    const within = value => value.bounds.left >= value.viewport.left - 2 && value.bounds.top >= value.viewport.top - 2 &&
      value.bounds.right <= value.viewport.right + 2 && value.bounds.bottom <= value.viewport.bottom + 2;
    assert.ok(within(fit), 'fit must contain SVG in viewport');
    await page.setViewportSize({ width: 640, height: 480 });
    await page.waitForTimeout(100);
    assert.ok(within(await computed()), 'resize must refit open inspector');
    const beforeDrag = (await computed()).transform;
    const area = await page.locator('#diagram-viewport').boundingBox();
    await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
    await page.mouse.down();
    await page.mouse.move(area.x + area.width / 2 + 20, area.y + area.height / 2 + 15);
    await page.mouse.up();
    assert.notEqual((await computed()).transform, beforeDrag, 'drag must translate SVG');
    await page.keyboard.press('Escape');
    assert.equal(await dialog.count(), 0);
    const darkButton = page.getByRole('group', { name: 'Color theme' }).getByRole('button', { name: 'Dark' });
    const lightButton = page.getByRole('group', { name: 'Color theme' }).getByRole('button', { name: 'Light' });
    await page.locator('#document svg').evaluate(svg => { window.__previousDiagram = svg; });
    await darkButton.click();
    await page.waitForFunction(() => document.querySelector('#document svg') && document.querySelector('#document svg') !== window.__previousDiagram, null, { timeout: 20000 });
    assert.equal(await page.evaluate(() => window.__previousDiagram.isConnected), false);
    await page.locator('#document svg').evaluate(svg => { window.__previousDiagram = svg; });
    await darkButton.click();
    assert.equal(await page.locator('#document svg').evaluate(svg => svg === window.__previousDiagram), true, 'reselecting dark does not rerender');
    await lightButton.click();
    await page.waitForFunction(() => document.querySelector('#document svg') && document.querySelector('#document svg') !== window.__previousDiagram, null, { timeout: 20000 });
    await darkButton.click();
    await page.locator('#document svg').waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Expand diagram' }).click();
    const dark = await computed();
    assert.notEqual(dark.nodeFill, 'none');
    assert.notEqual(dark.edgeStroke, 'none');
    await page.keyboard.press('Escape');
    preview.updateDocument('```mermaid\nnot a diagram\n```');
    await page.getByText('Diagram could not be rendered').waitFor({ timeout: 20000 });
    preview.updateDocument('# Replaced');
    await page.getByRole('heading', { name: 'Replaced' }).waitFor();
    assert.equal(await page.locator('svg').count(), 0);
  } finally {
    await browser.close();
    await preview.close();
  }
});

test('late Mermaid import cannot insert a stale diagram after document replacement', async (t) => {
  const executablePath = await browserExecutable(t);
  if (!executablePath) return;
  const preview = await startPreview({ content: '```mermaid\nflowchart LR\n A --> B\n```' });
  const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    let release;
    const held = new Promise(resolve => { release = resolve; });
    let requested;
    const seen = new Promise(resolve => { requested = resolve; });
    await page.route('**/mermaid.js', async route => {
      requested();
      await held;
      await route.continue();
    });
    await page.goto(preview.url);
    await seen;
    preview.updateDocument('# Fresh document');
    await page.getByRole('heading', { name: 'Fresh document' }).waitFor({ timeout: 5000 });
    release();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.diagram, #document svg').count(), 0);
  } finally {
    await browser.close();
    await preview.close();
  }
});

test('oversized fenced supported code retains exact escaped text without highlighting', async (t) => {
  const executablePath = await browserExecutable(t);
  if (!executablePath) return;
  const source = '<script>"&</script>\n'.repeat(5000);
  const preview = await startPreview({ content: `\`\`\`html\n${source}\`\`\`` });
  const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.goto(preview.url);
    const code = page.locator('#document code.language-html');
    await code.waitFor();
    assert.equal(await code.textContent(), source);
    assert.equal(await code.locator('.hljs-attr, .hljs-tag, .hljs-name, span').count(), 0);
    assert.equal(await page.locator('#document script').count(), 0);
  } finally {
    await browser.close();
    await preview.close();
  }
});

test('fenced code highlights locally while preserving safe plain fallbacks and Mermaid', async (t) => {
  const executablePath = await browserExecutable(t);
  if (!executablePath) return;
  const samples = [
    ['js', 'function greet() { const value = "hi"; // note\n return value; }'], ['typescript', 'const value: number = 42;'],
    ['json', '{"value": true}'], ['python', 'def greet():\n  return "hi"'],
    ['bash', 'echo "hi"'], ['html', '<div class="x">hi</div>'],
    ['css', '.x { color: red; }'], ['lua', 'local value = true'],
  ];
  const malicious = '<img src=x onerror="window.__injected=true">';
  const content = [...samples.map(([lang, code]) => `\`\`\`${lang}\n${code}\n\`\`\``),
    `\`\`\`unknown\n${malicious}\n\`\`\``, `\`\`\`\n${malicious}\n\`\`\``,
    '\`\`\`mermaid\nflowchart LR\n A --> B\n\`\`\`'].join('\n\n');
  const preview = await startPreview({ content });
  const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.goto(preview.url);
    const check = async () => {
      for (const [lang, code] of samples) {
        const block = page.locator(`pre > code.language-${lang}`);
        assert.equal(await block.textContent(), `${code}\n`, lang);
        assert.ok(await block.locator('[class^="hljs-"]').count() > 0, lang);
        assert.equal(await block.locator('[style]').count(), 0, lang);
      }
      for (const selector of ['code.language-unknown', 'pre > code:not([class])']) {
        const block = page.locator(selector);
        assert.equal(await block.textContent(), `${malicious}\n`);
        assert.equal(await block.locator('span, img').count(), 0);
      }
      assert.equal(await page.evaluate(() => window.__injected), undefined);
      await page.locator('#document .diagram svg').waitFor({ timeout: 20000 });
    };
    await check();
    const semantic = [
      ['js', '.hljs-string', '"hi"'], ['js', '.hljs-title.function_', 'greet'],
      ['js', '.hljs-comment', 'note'], ['typescript', '.hljs-number', '42'],
      ['html', '.hljs-name', 'div'], ['html', '.hljs-attr', 'class'],
      ['css', '.hljs-attribute', 'color'], ['python', '.hljs-title.function_', 'greet'],
      ['python', '.hljs-string', '"hi"'],
    ];
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.getByRole('button', { name: 'Dark' }).click();
      for (const [lang, selector, text] of semantic) {
        const element = page.locator(`code.language-${lang} ${selector}`).filter({ hasText: text }).first();
        assert.equal(await element.count(), 1, `${theme} ${lang} ${selector}`);
        assert.notEqual(await element.evaluate(node => getComputedStyle(node).color),
          await page.locator(`code.language-${lang}`).evaluate(node => getComputedStyle(node).color), `${theme} ${lang} ${selector}`);
      }
    }
    await page.getByRole('button', { name: 'Light' }).click();
    const token = page.locator('code.language-js .hljs-keyword').first();
    const color = () => token.evaluate(element => getComputedStyle(element).color);
    const light = await color();
    assert.notEqual(light, await page.locator('code.language-js').evaluate(element => getComputedStyle(element).color));
    await page.getByRole('button', { name: 'Dark' }).click();
    await check();
    const dark = await color();
    assert.notEqual(dark, light);
    assert.notEqual(dark, await page.locator('code.language-js').evaluate(element => getComputedStyle(element).color));
    preview.updateDocument(`${content}\n\n# Refreshed`);
    await page.getByRole('heading', { name: 'Refreshed' }).waitFor();
    await check();
    assert.equal(await color(), dark);
  } finally {
    await browser.close();
    await preview.close();
  }
});

test('malformed fenced tokens remain responsive and preserve exact safe text', async (t) => {
  const executablePath = await browserExecutable(t);
  if (!executablePath) return;
  const cases = [
    ['html', '<img src=x onerror=alert(1)>\n' + '<a '.repeat(100000) + '<!--'.repeat(100000)],
    ['javascript', '/*'.repeat(200000) + '<script>alert(1)</script>'],
    ['css', '/*'.repeat(200000) + '<img src=x>'],
    ['css', 'a'.repeat(60000)],
    ['typescript', '/*'.repeat(200000) + '<img src=x>'],
  ];
  const preview = await startPreview({ content: '# Ready' });
  const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.goto(preview.url);
    for (const [language, source] of cases) {
      const start = performance.now();
      preview.updateDocument(`\`\`\`${language}\n${source}\n\`\`\``);
      await page.waitForFunction(({ language, source }) =>
        document.querySelector(`code.language-${language}`)?.textContent === `${source}\n`,
      { language, source }, { timeout: 10000 });
      assert.equal(await page.locator(`code.language-${language}`).textContent(), `${source}\n`);
      assert.equal(await page.locator('#document img, #document script').count(), 0);
      const elapsed = Math.round(performance.now() - start);
      t.diagnostic(`${language}: ${elapsed}ms`);
      assert.ok(elapsed < 5000, `${language} took ${elapsed}ms`);
    }
    preview.updateDocument('```css\n.card { color: #abc; margin: 12px; opacity: 0.5; }\n```');
    const css = page.locator('code.language-css');
    await css.getByText('12px').waitFor();
    assert.equal(await css.textContent(), '.card { color: #abc; margin: 12px; opacity: 0.5; }\n');
    assert.equal(await css.locator('.hljs-selector-class').filter({ hasText: '.card' }).count(), 1);
    for (const token of ['color', 'margin', 'opacity']) {
      assert.equal(await css.locator('.hljs-attribute').filter({ hasText: token }).count(), 1, token);
    }
    assert.equal(await css.locator('.hljs-number').count(), 3);
    assert.equal(await page.evaluate(() => 1 + 1), 2);
  } finally {
    await browser.close();
    await preview.close();
  }
});

test('browser renders safe Markdown and switches from light to dark', async (t) => {
  const executablePath = await browserExecutable(t);
  if (!executablePath) return;

  let preview;
  let browser;
  let context;
  try {
    preview = await startPreview({ content: '# Hello\n\n<script>window.__injected=true</script>\n\n[bad](javascript:alert(1))' });
    browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
    context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(preview.url);
    await page.getByRole('heading', { name: 'Hello', level: 1 }).waitFor();
    assert.equal(await page.locator('#document script').count(), 0);
    assert.equal(await page.evaluate(() => window.__injected), undefined);
    assert.equal(await page.locator('#document a[href^="javascript:"]').count(), 0);
    assert.equal(await page.locator('#document a').count(), 0);
    const group = page.getByRole('group', { name: 'Color theme' });
    const light = group.getByRole('button', { name: 'Light' });
    const dark = group.getByRole('button', { name: 'Dark' });
    assert.equal(await group.getByRole('button').count(), 2);
    assert.equal(await light.locator('[aria-hidden="true"]').textContent(), '☀');
    assert.equal(await dark.locator('[aria-hidden="true"]').textContent(), '☾');
    const selected = async () => [await light.getAttribute('aria-pressed'), await dark.getAttribute('aria-pressed')];
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    assert.deepEqual(await selected(), ['true', 'false']);
    await dark.click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    assert.deepEqual(await selected(), ['false', 'true']);
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    assert.deepEqual(await selected(), ['false', 'true']);
    await light.click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    assert.deepEqual(await selected(), ['true', 'false']);
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    assert.deepEqual(await selected(), ['true', 'false']);
  } finally {
    try {
      await context?.close();
    } finally {
      try {
        await browser?.close();
      } finally {
        await preview?.close();
      }
    }
  }
});
