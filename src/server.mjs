import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const ASSETS = new Map([
  ['/', [new URL('../web/index.html', import.meta.url), 'text/html; charset=utf-8']],
  ['/style.css', [new URL('../web/style.css', import.meta.url), 'text/css; charset=utf-8']],
  ['/app.js', [new URL('../dist/app.js', import.meta.url), 'text/javascript; charset=utf-8']],
  ['/mermaid.js', [new URL('../dist/mermaid.js', import.meta.url), 'text/javascript; charset=utf-8']],
]);
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; style-src-elem 'self' 'unsafe-inline'; style-src-attr 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self' data:; base-uri 'none'; form-action 'none'; object-src 'none'";

const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

function snapshot(content) {
  if (typeof content !== 'string' && !Buffer.isBuffer(content)) {
    throw new TypeError('Document content must be a string or Buffer');
  }
  const bytes = Buffer.from(content);
  if (bytes.length > MAX_DOCUMENT_BYTES) throw new RangeError('Document too large');
  return bytes;
}

/** Start a loopback-only preview with a bounded, private copy of the supplied document. */
export async function startPreview({ content } = {}) {
  let document = snapshot(content);
  let port;
  const server = createServer(async (request, response) => {
    if (request.headers.host !== `127.0.0.1:${port}`) {
      response.writeHead(403).end();
      return;
    }
    if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET' }).end();
      return;
    }
    if (request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('ok');
      return;
    }
    if (ASSETS.has(request.url)) {
      const [asset, type] = ASSETS.get(request.url);
      try {
        const bytes = await readFile(asset);
        response.writeHead(200, {
          'Content-Type': type,
          'Content-Security-Policy': CSP,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        }).end(bytes);
      } catch {
        response.writeHead(500).end();
      }
      return;
    }
    if (request.url !== '/document') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    }).end(document);
  });
  try {
    await new Promise((accept, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        accept();
      });
    });
  } catch (error) {
    server.close();
    throw error;
  }
  ({ port } = server.address());
  return {
    url: `http://127.0.0.1:${port}/`,
    updateDocument(nextContent) {
      document = snapshot(nextContent);
    },
    close: () => new Promise((accept, reject) => {
      if (!server.listening) { accept(); return; }
      server.close(error => error ? reject(error) : accept());
      server.closeAllConnections();
    }),
  };
}
