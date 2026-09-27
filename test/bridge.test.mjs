import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

async function exitWithin(child, milliseconds) {
  let timer;
  try {
    await Promise.race([
      once(child, 'exit'),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('bridge did not exit')), milliseconds); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function bridge(t) {
  const child = spawn(process.execPath, ['bin/mdscope-server.mjs'], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let output = '';
  const pending = [];
  let terminated;
  const fail = error => {
    terminated = error;
    while (pending.length) {
      const item = pending.shift();
      clearTimeout(item.timer);
      item.reject(error);
    }
  };
  child.on('error', fail);
  child.on('exit', (code, signal) => fail(new Error(`bridge exited: ${code ?? signal}`)));
  child.stdout.on('data', chunk => {
    output += chunk;
    let index;
    while ((index = output.indexOf('\n')) !== -1) {
      const line = output.slice(0, index);
      output = output.slice(index + 1);
      const item = pending.shift();
      if (item) {
        clearTimeout(item.timer);
        try { item.resolve(JSON.parse(line)); } catch (error) { item.reject(error); }
      }
    }
  });
  return {
    child,
    send(message) {
      return new Promise((resolve, reject) => {
        if (terminated) { reject(terminated); return; }
        const item = { resolve, reject, timer: setTimeout(() => reject(new Error('bridge response timed out')), 3000) };
        pending.push(item);
        child.stdin.write(JSON.stringify(message) + '\n', error => { if (error) fail(error); });
      });
    },
  };
}

test('stdin JSON initializes and updates private snapshot; HTTP cannot write; stop closes', async t => {
  const session = bridge(t);
  const { url } = await session.send({ type: 'init', content: '# Unsaved' });
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.equal(await (await fetch(new URL('/document', url))).text(), '# Unsaved');
  assert.equal((await fetch(new URL('/document', url), { method: 'POST', body: 'evil' })).status, 405);
  assert.equal((await session.send({ type: 'update', content: '# New' })).ok, true);
  assert.equal(await (await fetch(new URL('/document', url))).text(), '# New');
  session.child.stdin.write('{"type":"stop"}\n');
  await once(session.child, 'exit');
  await assert.rejects(fetch(new URL('/document', url)));
});

test('init followed immediately by EOF or stop closes any preview opened in flight', async t => {
  for (const ending of ['eof', 'stop']) {
    const session = bridge(t);
    let output = '';
    session.child.stdout.on('data', chunk => { output += chunk; });
    session.child.stdin.end(JSON.stringify({ type: 'init', content: '# Racing' }) + '\n' +
      (ending === 'stop' ? '{"type":"stop"}\n' : ''));
    await exitWithin(session.child, 3000);
    const url = output.match(/"url":"(http:\/\/127\.0\.0\.1:\d+\/?)"/)?.[1];
    if (url) await assert.rejects(fetch(new URL('/document', url)));
  }
});

test('valid newline-heavy document below 8 MiB passes JSON framing', async t => {
  const session = bridge(t);
  const content = '\n'.repeat(5 * 1024 * 1024);
  const { url, error } = await session.send({ type: 'init', content });
  assert.equal(error, undefined);
  assert.equal((await (await fetch(new URL('/document', url))).text()).length, content.length);
  session.child.stdin.end();
  await once(session.child, 'exit');
});

test('init and oversized trailing chunk close any preview opened in flight', async t => {
  const session = bridge(t);
  let output = '';
  session.child.stdout.on('data', chunk => { output += chunk; });
  session.child.stdin.write(JSON.stringify({ type: 'init', content: '# Racing' }) + '\n' +
    'x'.repeat(48 * 1024 * 1024 + 1025));
  await exitWithin(session.child, 15000);
  assert.match(output, /Message too large/);
  const url = output.match(/"url":"(http:\/\/127\.0\.0\.1:\d+\/?)"/)?.[1];
  if (url) await assert.rejects(fetch(new URL('/document', url)));
});

test('unterminated oversized stdin chunk is rejected before a newline', async t => {
  const session = bridge(t);
  const response = new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('unterminated chunk response timed out')), 15000);
    session.child.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes('\n')) {
        clearTimeout(timer);
        resolve(JSON.parse(output.split('\n')[0]));
      }
    });
  });
  session.child.stdin.write('x'.repeat(48 * 1024 * 1024 + 1025));
  assert.match((await response).error, /large/i);
  session.child.stdin.end();
  await once(session.child, 'exit');
});

test('oversized or malformed messages return safe errors and retain last snapshot; EOF closes', async t => {
  const session = bridge(t);
  const { url } = await session.send({ type: 'init', content: '# Safe' });
  const error = await session.send({ type: 'update', content: 'x'.repeat(8 * 1024 * 1024 + 1) });
  assert.equal(error.ok, false);
  assert.equal(await (await fetch(new URL('/document', url))).text(), '# Safe');
  const invalid = await session.send({ type: 'update', content: 5 });
  assert.equal(invalid.ok, false);
  session.child.stdin.end();
  await once(session.child, 'exit');
  await assert.rejects(fetch(new URL('/document', url)));
});
