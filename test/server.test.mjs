import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request } from 'node:http';
import { startPreview } from '../src/server.mjs';

const MAX_BYTES = 8 * 1024 * 1024;

test('buffer snapshots update immediately without a document path or browser mutation route', async (t) => {
  const preview = await startPreview({ content: '# First' });
  t.after(() => preview.close());
  const url = new URL(preview.url);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(await (await fetch(new URL('/health', url))).text(), 'ok');
  assert.equal(await (await fetch(new URL('/document', url))).text(), '# First');
  preview.updateDocument('# Changed');
  assert.equal(await (await fetch(new URL('/document', url))).text(), '# Changed');
  assert.equal((await fetch(new URL('/missing', url))).status, 404);
  assert.equal((await fetch(new URL('/assets/file', url))).status, 404);
  const post = await fetch(new URL('/document', url), { method: 'POST', body: '# Browser' });
  assert.equal(post.status, 405);
  assert.equal(await (await fetch(new URL('/document', url))).text(), '# Changed');
  await preview.close();
  await preview.close();
  await assert.rejects(fetch(new URL('/health', url)));
});

test('UTF-8 byte cap rejects oversized initial and updates without losing the last snapshot', async (t) => {
  const oversized = 'é'.repeat(MAX_BYTES / 2 + 1);
  await assert.rejects(startPreview({ content: oversized }), /large|size/i);
  await assert.rejects(startPreview({ content: Buffer.alloc(MAX_BYTES + 1) }), /large|size/i);
  const preview = await startPreview({ content: '# Safe' });
  t.after(() => preview.close());
  assert.throws(() => preview.updateDocument(oversized), /large|size/i);
  assert.throws(() => preview.updateDocument(Buffer.alloc(MAX_BYTES + 1)), /large|size/i);
  assert.equal(await (await fetch(new URL('/document', preview.url))).text(), '# Safe');
  preview.updateDocument(Buffer.from('# Bytes'));
  assert.equal(await (await fetch(new URL('/document', preview.url))).text(), '# Bytes');
  assert.throws(() => preview.updateDocument(undefined), TypeError);
});

test('loopback Host validation prevents cross-origin requests to memory snapshot', async (t) => {
  const preview = await startPreview({ content: '# Safe' });
  t.after(() => preview.close());
  for (const host of ['attacker.example', '127.0.0.1:1', 'localhost:1']) {
    const status = await new Promise((resolve, reject) => {
      const req = request(new URL('/document', preview.url), { headers: { Host: host }, agent: false }, response => {
        response.resume();
        resolve(response.statusCode);
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 403, host);
  }
  assert.equal((await fetch(new URL('/document', preview.url))).status, 200);
});
