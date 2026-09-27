import { build } from 'esbuild';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const bundles = [['web/app.js', 'iife'], ['web/mermaid.js', 'esm']];
const packages = new Map();
for (const [entry, format] of bundles) {
  const { metafile } = await build({ entryPoints: [entry], bundle: true, format,
    target: 'es2020', write: false, metafile: true, logLevel: 'silent' });
  for (const input of Object.keys(metafile.inputs)) {
    if (!input.startsWith('node_modules/')) continue;
    const parts = input.split('/');
    const segment = parts.lastIndexOf('node_modules');
    const name = parts[segment + 1].startsWith('@')
      ? parts.slice(segment + 1, segment + 3).join('/') : parts[segment + 1];
    const directory = parts.slice(0, segment + (name.startsWith('@') ? 3 : 2)).join('/');
    if (!packages.has(directory)) packages.set(directory, { name, bundlesUsed: new Set() });
    packages.get(directory).bundlesUsed.add(entry === 'web/app.js' ? 'app' : 'mermaid');
  }
}

const sections = ['# Bundled third-party licenses', '',
  'Generated from installed npm packages and esbuild input graphs by `npm run build`.',
  'Regenerate after `npm ci` with `npm run build`. Text below is copied verbatim from package files.', ''];
const included = new Set();
for (const [directory, { name, bundlesUsed }] of [...packages].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  included.add(`${name}@${manifest.version}`);
  const files = await readdir(directory);
  const licenseFiles = files.filter(file => /^licen[cs]e(?:[.-]|$)/i.test(file) && !/license-update/i.test(file)).sort();
  let texts;
  if (licenseFiles.length) {
    texts = await Promise.all(licenseFiles.map(async file => [file, await readFile(join(directory, file), 'utf8')]));
  } else if (name === 'fastdom') {
    // This npm tarball ships its complete license in README.md, not a separate LICENSE file.
    const readme = await readFile(join(directory, 'README.md'), 'utf8');
    const match = readme.match(/^## License\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m);
    if (!match || !match[1].includes('Permission is hereby granted')) throw new Error('Missing upstream fastdom README license');
    texts = [['README.md § License', match[1]]];
  } else {
    throw new Error(`Missing upstream license file: ${name}@${manifest.version}`);
  }
  if (files.includes('NOTICE')) texts.push(['NOTICE', await readFile(join(directory, 'NOTICE'), 'utf8')]);
  for (const [file, text] of texts) {
    if (!text.trim()) throw new Error(`Empty upstream license: ${name}/${file}`);
    sections.push(`## ${name}@${manifest.version} (${[...bundlesUsed].sort().join(', ')}) — ${file}`, '',
      '```text', text.replace(/\s+$/, ''), '```', '');
  }
}
await writeFile('THIRD_PARTY_LICENSES.md', sections.join('\n') + '\n');
console.log(`Bundled license texts: ${included.size} unique name@version packages (${packages.size} package roots; app: ${[...packages.values()].filter(v => v.bundlesUsed.has('app')).length}; mermaid: ${[...packages.values()].filter(v => v.bundlesUsed.has('mermaid')).length})`);
