import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { startPreview } from '../src/server.mjs';
import MarkdownIt from 'markdown-it';

 test('serves HTML and only named local UI assets with restrictive headers', async (t) => {
  const preview = await startPreview({ content: '# Hello' });
  t.after(() => preview.close());
  for (const [path, type] of [['/', 'text/html'], ['/style.css', 'text/css'], ['/app.js', 'javascript']]) {
    const response = await fetch(new URL(path, preview.url));
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), new RegExp(type));
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
    assert.ok((await response.text()).length > 0);
  }
  for (const path of ['/web/app.js', '/src/server.mjs', '/package.json', '/%2e%2e/package.json', '/foo/../package.json', '/assets/private']) {
    assert.equal((await fetch(new URL(path, preview.url))).status, 404, path);
  }
  assert.match(await (await fetch(preview.url)).text(), /app\.js/);
});

test('bundled Markdown rendering disables raw HTML and dangerous links', async () => {
  const bundle = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
  assert.ok(bundle.length > 1000);
  const source = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
  assert.match(source, /html:\s*false/);
  assert.match(source, /\.render\(/);
  assert.match(source, /textContent/);
  assert.match(source, /\/document/);
  assert.match(source, /if \(request !== latestRequest\) return;/, 'stale document responses must not render');
  assert.match(source, /article\.innerHTML = markdown\.render\(content\)/);
  assert.doesNotMatch(source, /https?:\/\//);
  const render = new MarkdownIt({ html: false, linkify: true, typographer: true });
  const output = render.render('<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n# Safe');
  assert.doesNotMatch(output, /<script|href="javascript:/);
  assert.match(output, /&lt;script&gt;/);
  assert.match(output, /<h1>Safe<\/h1>/);
});
