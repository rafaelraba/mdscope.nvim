import { startPreview } from '../src/server.mjs';

let preview;
let closing = false;
let queue = Promise.resolve();
let pending = [];
let pendingBytes = 0;
// JSON may escape each document byte as six ASCII characters (\\u00XX).
const MAX_LINE = 48 * 1024 * 1024 + 1024;

async function close() {
  if (closing) return;
  closing = true;
  process.stdin.destroy();
  await preview?.close();
}

function scheduleClose() {
  queue = queue.then(close, close);
}

function respond(error) {
  process.stdout.write(JSON.stringify({ ok: false, error: error.message }) + '\n');
}

function handle(line) {
  process.stdin.pause();
  queue = queue.then(async () => {
    if (closing) return;
    try {
      const message = JSON.parse(line.toString('utf8'));
      if (message.type === 'init' && !preview) {
        preview = await startPreview({ content: message.content });
        process.stdout.write(JSON.stringify({ ok: true, url: preview.url }) + '\n');
      } else if (message.type === 'update' && preview) {
        preview.updateDocument(message.content);
        process.stdout.write('{"ok":true}\n');
      } else if (message.type === 'stop') {
        await close();
      } else {
        throw new Error('Invalid message');
      }
    } catch (error) {
      respond(error);
    } finally {
      if (!closing) process.stdin.resume();
    }
  });
}

process.stdin.on('data', chunk => {
  let offset = 0;
  while (offset < chunk.length && !closing) {
    const newline = chunk.indexOf(10, offset);
    const end = newline === -1 ? chunk.length : newline;
    const length = end - offset;
    if (pendingBytes + length > MAX_LINE) {
      respond(new RangeError('Message too large'));
      process.stdin.pause();
      scheduleClose();
      return;
    }
    pending.push(chunk.subarray(offset, end));
    pendingBytes += length;
    if (newline === -1) return;
    handle(Buffer.concat(pending, pendingBytes));
    pending = [];
    pendingBytes = 0;
    offset = newline + 1;
  }
});
process.stdin.on('end', scheduleClose);
process.stdin.on('error', scheduleClose);
