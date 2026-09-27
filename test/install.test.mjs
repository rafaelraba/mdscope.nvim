import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');

test('README documents neutral and lazy.nvim installation with runtime dependencies', async () => {
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  assert.match(readme, /packadd|runtimepath/i);
  assert.match(readme, /lazy\.nvim/i);
  assert.match(readme, /Neovim.*0\.10/i);
  assert.match(readme, /Node(?:\.js)?.*20/i);
  assert.match(readme, /rafaelraba\/mdscope\.nvim/);
  assert.doesNotMatch(readme, /OWNER\/mdscope\.nvim|placeholder|not a published project/i);
});

test('release metadata enables linked legal notices for both browser bundles', async () => {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.private, true);
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.repository.url, 'https://github.com/rafaelraba/mdscope.nvim.git');
  assert.equal((pkg.scripts.build.match(/--legal-comments=linked/g) ?? []).length, 2);
  const bundle = await readFile(join(root, 'dist', 'mermaid.js'), 'utf8');
  const legal = await readFile(join(root, 'dist', 'mermaid.js.LEGAL.txt'), 'utf8');
  assert.match(bundle, /mermaid\.js\.LEGAL\.txt/);
  assert.ok(legal.trim().length > 0);
});

test('optional package auto-registers commands via packadd without setup', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'mdscope-packadd-'));
  const installed = join(temporary, 'data', 'site', 'pack', 'mdscope', 'opt', 'mdscope.nvim');
  const elsewhere = join(temporary, 'elsewhere');
  t.after(async () => { await (await import('node:fs/promises')).rm(temporary, { recursive: true, force: true }); });
  await (await import('node:fs/promises')).mkdir(elsewhere, { recursive: true });
  for (const directory of ['src', 'bin', 'lua', 'plugin', 'web', 'dist']) {
    await cp(join(root, directory), join(installed, directory), { recursive: true });
  }
  const script = `
    vim.opt.packpath:prepend(${JSON.stringify(join(temporary, 'data', 'site'))})
    vim.cmd('packadd mdscope.nvim')
    assert(vim.fn.exists(':MdscopeStart') == 2, 'packadd did not register MdscopeStart')
    vim.cmd('enew')
    vim.bo.filetype = 'markdown'
    vim.api.nvim_buf_set_lines(0, 0, -1, false, { '# Unsaved package preview' })
    vim.cmd('MdscopeStart')
  `;
  const child = spawn('nvim', ['--headless', '-u', 'NONE', '-c', `lua local ok, err = pcall(function() ${script} end); if not ok then io.stderr:write(tostring(err)); vim.cmd('cquit 1') end`, '-c', 'qa!'], {
    cwd: elsewhere, env: { ...process.env, XDG_CONFIG_HOME: join(temporary, 'config'), XDG_DATA_HOME: join(temporary, 'data'), XDG_STATE_HOME: join(temporary, 'state'), XDG_CACHE_HOME: join(temporary, 'cache') },
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk; });
  const code = await new Promise((done, reject) => { child.on('error', reject); child.on('exit', done); });
  assert.equal(code, 0, output);
});

test('isolated installed tree previews an unsaved buffer from an unrelated cwd and stops', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'mdscope-install-'));
  const installed = join(temporary, 'plugin-tree');
  const elsewhere = join(temporary, 'elsewhere');
  t.after(async () => { await (await import('node:fs/promises')).rm(temporary, { recursive: true, force: true }); });
  await (await import('node:fs/promises')).mkdir(elsewhere);
  for (const directory of ['src', 'bin', 'lua', 'plugin', 'web', 'dist']) {
    await cp(join(root, directory), join(installed, directory), { recursive: true });
  }
  const licenses = await readFile(join(root, 'THIRD_PARTY_LICENSES.md'), 'utf8');
  assert.match(licenses, /Apache License\s+Version 2\.0/);
  assert.match(licenses, /highlight\.js@11\.12\.0/);
  assert.match(licenses, /khroma@2\.1\.0/);
  assert.match(licenses, /d3@7\.9\.0/);
  for (const [name, version] of [['d3-array', '2.12.1'], ['d3-shape', '1.3.7'], ['d3-path', '1.0.9']]) {
    assert.match(licenses, new RegExp(`^## ${name}@${version} \\(mermaid\\) — LICENSE`, 'm'));
    assert.match(licenses, new RegExp(`^## ${name}@${version}[^\\n]*\\n\\n\x60\x60\x60text\\n[\\s\\S]*?Permission is hereby granted`, 'm'));
  }
  assert.match(licenses, /BSD 3-Clause License|Redistribution and use in source and binary forms/);
  assert.equal((licenses.match(/^## .*@.* — /gm) ?? []).length >= 65, true);
  for (const name of ['THIRD_PARTY_LICENSES.md', 'THIRD_PARTY_NOTICES.md']) {
    await cp(join(root, name), join(installed, name));
  }
  assert.equal(await readFile(join(installed, 'THIRD_PARTY_LICENSES.md'), 'utf8'), licenses);
  assert.match(await readFile(join(installed, 'THIRD_PARTY_NOTICES.md'), 'utf8'), /THIRD_PARTY_LICENSES\.md/);
  await assert.rejects(stat(join(installed, 'node_modules')));
  const script = `
    vim.opt.runtimepath:append(${JSON.stringify(installed)})
    vim.cmd('runtime plugin/mdscope.lua')
    require('mdscope').setup({ open_browser = false })
    vim.cmd('enew')
    vim.bo.filetype = 'markdown'
    vim.api.nvim_buf_set_lines(0, 0, -1, false, { '# Fresh installation' })
    vim.cmd('MdscopeStart')
    local session
    assert(vim.wait(5000, function()
      session = require('mdscope').sessions[vim.api.nvim_get_current_buf()]
      return session and session.url ~= nil
    end), 'preview URL unavailable')
    local url = session.url
    assert(url:match('^http://127%.0%.0%.1:%d+/$'))
    local response = vim.fn.system({ 'node', '-e', 'fetch(process.argv[1]+"document").then(r=>r.text()).then(s=>{if(s!=="# Fresh installation")process.exit(1)})', url })
    assert(vim.v.shell_error == 0, 'snapshot unavailable: ' .. response)
    vim.cmd('MdscopeStop')
    assert(require('mdscope').sessions[vim.api.nvim_get_current_buf()] == nil)
    assert(vim.wait(5000, function() return vim.fn.jobwait({ session.job }, 0)[1] ~= -1 end), 'server did not exit')
  `;
  const child = spawn('nvim', ['--headless', '-u', 'NONE', '-c', `lua ${script}`, '-c', 'qa!'], {
    cwd: elsewhere, env: { ...process.env, XDG_CONFIG_HOME: join(temporary, 'config'), XDG_DATA_HOME: join(temporary, 'data'), XDG_STATE_HOME: join(temporary, 'state'), XDG_CACHE_HOME: join(temporary, 'cache') },
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk; });
  const code = await new Promise((done, reject) => { child.on('error', reject); child.on('exit', done); });
  assert.equal(code, 0, output);
});
