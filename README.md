# mdscope.nvim

Preview the current Markdown buffer in a responsive browser reader, including unsaved edits and expandable Mermaid diagrams. The preview runs locally; no CDN or npm installation is needed for users of the bundled files.

## Quick start

Requirements: Neovim 0.10 or later, Node.js 20 or later on `PATH`, and a browser. The plugin starts Node with `vim.fn.jobstart`, uses `vim.uv`, `vim.ui.open`, and the built-in Lua APIs. Node 20 provides the runtime APIs used by the server; the bundled browser JavaScript needs a modern browser.

Install `https://github.com/rafaelraba/mdscope.nvim` as a Neovim plugin. With any plugin manager, add `rafaelraba/mdscope.nvim` to its plugin list. Loading the plugin automatically registers commands with default settings; call `require('mdscope').setup({...})` only to customize them. For a manual installation, place the repository in a package directory and run `:packadd mdscope.nvim`; alternatively append its directory to `runtimepath` and source `plugin/mdscope.lua`.

With lazy.nvim:

```lua
{
  'rafaelraba/mdscope.nvim', -- for a local checkout, use dir = '/path/to/mdscope.nvim'
  -- Optional: config = function() require('mdscope').setup({ open_browser = false }) end,
}
```

Open a Markdown buffer and run `:MdscopeStart`. The browser opens at a loopback URL; edits update its snapshot. Run `:MdscopeStop` to close the preview. Wiping the buffer also stops its session. Commands are registered when the plugin loads. An explicit later `setup()` replaces the default options.

## Setup and controls

```lua
require('mdscope').setup({
  node = 'node',          -- Node executable on PATH
  open_browser = true,   -- false: start without opening the URL automatically
  -- server = '/path/to/mdscope-server.mjs', -- advanced override
})
```

The reader has a light/dark theme toggle. Fenced code uses locally bundled Highlight.js grammar colors for JavaScript (`js`, `jsx`), TypeScript (`ts`, `tsx`), JSON, Python (`py`), Bash (`sh`, `shell`, `zsh`), HTML (`htm`), CSS, and Lua. Unknown or unlabeled fences stay escaped plain text. Supported fences longer than 64 KiB (65,536 JavaScript code units) also fall back to complete escaped plain text, retaining their language class without truncation; this bounds synchronous grammar work. Highlighting is bundled locally, works offline without runtime npm dependencies, and updates with the document and theme. Only the listed grammars are registered; language autodetection is disabled. Grammar highlighting is lexical, not a full semantic parser, so some identifiers remain uncolored. For a Mermaid code block, choose **Expand diagram** to open its inspector; use the zoom-in/out buttons or mouse wheel to zoom, drag to pan, **Fit** to fit the viewport, **Reset** for original scale, and **Close** or Escape to return. The inspector keeps keyboard focus within the browser's modal while open. Invalid diagrams show a fallback instead of stopping the document preview.

## Security and current limits

- The Node server binds to `127.0.0.1` on an ephemeral port, checks the HTTP Host, and accepts document bytes only through the Neovim-to-Node process channel. The browser cannot write the snapshot. Treat the URL as local private data; other local processes may access it while running.
- The server stores a bounded in-memory snapshot (up to 8 MiB); it does not read your Markdown file. Unsaved buffers work. No remote runtime assets are requested: built `dist/` bundles and `web/` assets ship with the plugin.
- Raw Markdown HTML is disabled. Mermaid uses strict security mode; the page applies a restrictive content security policy. This is not a sandbox for untrusted browser extensions or a promise that every external link is safe.
- Relative local images and files are not served; synchronized editor/browser scrolling is not implemented. External links may leave the local preview when clicked.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `:MdscopeStart` is unknown | Confirm the plugin has loaded (`:packadd mdscope.nvim` for an optional package). |
| Nothing opens | Check `node --version`, the Markdown filetype (`:set filetype?`), browser opener, and `open_browser`; with `open_browser = false`, inspect `require('mdscope').sessions[vim.api.nvim_get_current_buf()].url`. |
| Page lacks styling or diagrams | Confirm the installed tree contains `web/` and `dist/`; the bundles are required at runtime. |
| Image does not display | Relative local asset serving is not supported yet. |

## Local development

From a checkout with Node and npm installed, install development dependencies using `npm ci`, build bundles with `npm run build`, and run `node --test` plus:

```sh
nvim --headless -u NONE -c 'set rtp+=.' -c 'luafile test/nvim.lua' -c 'qa!'
```

Browser tests use `MDSCOPE_CHROMIUM` if set (an invalid explicit path fails the tests), otherwise Playwright's bundled Chromium when installed, then `/usr/bin/chromium`; they skip only when neither default executable exists. Install the bundled browser with `npx playwright install chromium`, or set `MDSCOPE_CHROMIUM` to an executable Chromium path. End users do **not** need npm, Playwright, or `node_modules`; retain `src/`, `bin/`, `lua/`, `plugin/`, `web/`, and `dist/` when distributing the plugin.
