local function wait_until(predicate)
  assert(vim.wait(4000, predicate, 10), 'timed out waiting for bridge')
end
vim.opt.runtimepath:append('.')
local opened = {}
local original_open = vim.ui.open
vim.ui.open = function(url) table.insert(opened, url); return true end
require('mdscope').setup()
assert(vim.fn.exists(':MdscopeStart') == 2)
assert(vim.fn.exists(':MdscopeStop') == 2)
local buffer = vim.api.nvim_get_current_buf()
vim.bo[buffer].filetype = 'markdown'
vim.api.nvim_buf_set_lines(buffer, 0, -1, false, { '# Unsaved snapshot' })
local original_cwd = vim.fn.getcwd()
vim.cmd('cd /tmp')
vim.cmd('MdscopeStart')
local session = require('mdscope').sessions[buffer]
assert(session and session.job, 'start must create buffer session')
assert(vim.wait(4000, function() return session.url ~= nil end, 10), 'bridge failed: ' .. tostring(session.error) .. ' output=' .. session.output)
wait_until(function() return #opened == 1 end)
assert(opened[1] == session.url, 'start must open preview URL')
vim.cmd('cd ' .. vim.fn.fnameescape(original_cwd))
local function autocmd_count()
  return #vim.api.nvim_get_autocmds({ group = 'MdscopePreview', buffer = buffer })
end
local active_count = autocmd_count()
local result = vim.fn.system({ 'curl', '-fsS', session.url .. 'document' })
assert(result == '# Unsaved snapshot', result)
vim.api.nvim_buf_set_lines(buffer, 0, -1, false, { '# Edited' })
wait_until(function()
  return vim.fn.system({ 'curl', '-fsS', session.url .. 'document' }) == '# Edited'
end)
vim.cmd('MdscopeStop')
assert(require('mdscope').sessions[buffer] == nil)
assert(autocmd_count() == 0, 'stop must delete session autocmds')
assert(vim.fn.jobwait({ session.job }, 2000)[1] ~= -1, 'stop must terminate process')
vim.cmd('MdscopeStart')
local next_session = require('mdscope').sessions[buffer]
wait_until(function() return next_session.url ~= nil end)
assert(autocmd_count() == active_count, 'restart must not accumulate autocmds')
vim.bo[buffer].filetype = 'text'
wait_until(function() return require('mdscope').sessions[buffer] == nil end)
assert(vim.fn.jobwait({ next_session.job }, 2000)[1] ~= -1, 'filetype transition must stop bridge')
vim.bo[buffer].filetype = 'markdown'
vim.cmd('MdscopeStart')
next_session = require('mdscope').sessions[buffer]
wait_until(function() return next_session.url ~= nil end)
vim.api.nvim_buf_delete(buffer, { force = true })
assert(require('mdscope').sessions[buffer] == nil, 'wipeout must clean session')
assert(vim.fn.jobwait({ next_session.job }, 2000)[1] ~= -1)
require('mdscope').setup({ open_browser = false })
vim.bo[vim.api.nvim_get_current_buf()].filetype = 'markdown'
local opt_out_buffer = vim.api.nvim_get_current_buf()
require('mdscope').start(opt_out_buffer)
wait_until(function() return require('mdscope').sessions[opt_out_buffer].url ~= nil end)
assert(#opened == 3, 'open_browser=false must not open browser')
require('mdscope').stop(opt_out_buffer)
vim.ui.open = original_open
