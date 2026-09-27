import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import lua from 'highlight.js/lib/languages/lua';

const escapeHtml = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const aliases = { js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', sh: 'bash', shell: 'bash', zsh: 'bash', htm: 'html' };
const supported = new Set(['javascript', 'typescript', 'json', 'python', 'bash', 'html', 'css', 'lua']);
const maxHighlightLength = 64 * 1024;
for (const [name, grammar] of Object.entries({ javascript, typescript, json, python, bash, html: xml, css, lua })) {
  hljs.registerLanguage(name, grammar);
}
hljs.configure({ ignoreUnescapedHTML: true, throwUnescapedHTML: true });
function highlight(code, label) {
  const language = aliases[label.toLowerCase()] || label.toLowerCase();
  if (!supported.has(language) || code.length > maxHighlightLength) return escapeHtml(code);
  return hljs.highlight(code, { language, ignoreIllegals: true }).value;
}
const markdown = new MarkdownIt({ html: false, linkify: true, typographer: true, highlight });
const article = document.getElementById('document');
const inspector = document.getElementById('inspector');
const viewport = document.getElementById('diagram-viewport');
let generation = 0;
let diagramId = 0;
let scale = 1;
let offsetX = 0;
let offsetY = 0;
let activeDiagram = null;
let originalSlot = null;
let previousFocus = null;

function transform() {
  const svg = viewport.querySelector('svg');
  if (svg) svg.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
}
function reset() { scale = 1; offsetX = offsetY = 0; transform(); }
function closeInspector() {
  if (!inspector.open) return;
  if (activeDiagram && originalSlot?.isConnected) originalSlot.prepend(activeDiagram);
  inspector.close();
  activeDiagram = originalSlot = null;
  previousFocus?.focus();
}
inspector.addEventListener('close', closeInspector);
inspector.addEventListener('cancel', event => { event.preventDefault(); closeInspector(); });
inspector.addEventListener('click', event => { if (event.target === inspector) closeInspector(); });
document.getElementById('close-diagram').addEventListener('click', closeInspector);
document.getElementById('zoom-in').addEventListener('click', () => { scale = Math.min(8, scale * 1.25); transform(); });
document.getElementById('zoom-out').addEventListener('click', () => { scale = Math.max(.1, scale / 1.25); transform(); });
document.getElementById('fit-diagram').addEventListener('click', () => {
  const svg = viewport.querySelector('svg');
  if (!svg) return;
  const box = svg.viewBox.baseVal;
  scale = box.width && box.height ? Math.min(1, viewport.clientWidth / box.width, viewport.clientHeight / box.height) : 1;
  offsetX = offsetY = 0;
  transform();
});
document.getElementById('reset-diagram').addEventListener('click', reset);
viewport.addEventListener('wheel', event => {
  event.preventDefault();
  scale = Math.max(.1, Math.min(8, scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
  transform();
}, { passive: false });
let drag;
viewport.addEventListener('pointerdown', event => { drag = { x: event.clientX, y: event.clientY }; viewport.setPointerCapture(event.pointerId); });
viewport.addEventListener('pointermove', event => {
  if (!drag) return;
  offsetX += event.clientX - drag.x; offsetY += event.clientY - drag.y;
  drag = { x: event.clientX, y: event.clientY }; transform();
});
viewport.addEventListener('pointerup', () => { drag = null; });
window.addEventListener('resize', () => { if (inspector.open) document.getElementById('fit-diagram').click(); });

async function renderDiagrams() {
  const current = ++generation;
  const blocks = [...article.querySelectorAll('pre > code.language-mermaid')];
  if (!blocks.length) return;
  try {
    const { renderDiagram } = await import('/mermaid.js');
    for (const block of blocks) {
      if (current !== generation || !block.isConnected) return;
      const source = block.textContent;
      const holder = document.createElement('div');
      holder.className = 'diagram';
      try {
        const svg = await renderDiagram(source, `mdscope-diagram-${++diagramId}`, document.documentElement.dataset.theme === 'dark');
        if (current !== generation || !block.isConnected) return;
        holder.innerHTML = svg;
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = 'Expand diagram';
        button.addEventListener('click', () => {
          previousFocus = button;
          originalSlot = holder;
          activeDiagram = holder.querySelector('svg');
          viewport.append(activeDiagram);
          reset(); inspector.showModal();
          document.getElementById('close-diagram').focus();
        });
        holder.append(button);
      } catch {
        if (current !== generation || !block.isConnected) return;
        holder.textContent = 'Diagram could not be rendered';
        const fallback = document.createElement('pre');
        fallback.textContent = source;
        holder.append(fallback);
      }
      block.parentElement.replaceWith(holder);
    }
  } catch {
    if (current !== generation) return;
    for (const block of blocks) {
      if (!block.isConnected) continue;
      const message = document.createElement('p');
      message.textContent = 'Diagram could not be rendered';
      block.parentElement.before(message);
    }
  }
}

const status = document.getElementById('status');
const lightButton = document.getElementById('theme-light');
const darkButton = document.getElementById('theme-dark');

function applyTheme(value) {
  document.documentElement.dataset.theme = value;
  lightButton.setAttribute('aria-pressed', String(value === 'light'));
  darkButton.setAttribute('aria-pressed', String(value === 'dark'));
}

applyTheme(localStorage.getItem('mdscope-theme') === 'dark' ? 'dark' : 'light');
for (const [button, value] of [[lightButton, 'light'], [darkButton, 'dark']]) {
  button.addEventListener('click', () => {
    if (document.documentElement.dataset.theme === value) return;
    applyTheme(value);
    localStorage.setItem('mdscope-theme', value);
    if (update.previous) {
      ++generation;
      closeInspector();
      article.innerHTML = markdown.render(update.previous);
      renderDiagrams();
    }
  });
}

let latestRequest = 0;
async function update() {
  const request = ++latestRequest;
  try {
    const response = await fetch('/document', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const content = await response.text();
    if (request !== latestRequest) return;
    if (content !== update.previous) {
      ++generation;
      closeInspector();
      article.innerHTML = markdown.render(content);
      update.previous = content;
      renderDiagrams();
    }
    status.textContent = '';
  } catch {
    if (request !== latestRequest) return;
    status.textContent = 'Preview disconnected. Waiting for the editor…';
  }
}
update();
setInterval(update, 1000);
