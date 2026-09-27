local M = { sessions = {} }
local group
local config = {}
local module_path = debug.getinfo(1, 'S').source:sub(2)
local server_path = vim.fn.fnamemodify(module_path, ':p:h:h:h') .. '/bin/mdscope-server.mjs'

local function content(buffer)
  return table.concat(vim.api.nvim_buf_get_lines(buffer, 0, -1, false), '\n')
end

local function send(session, message)
  if not session.job then return end
  pcall(vim.fn.chansend, session.job, vim.fn.json_encode(message) .. '\n')
end

function M.stop(buffer)
  buffer = buffer or vim.api.nvim_get_current_buf()
  local session = M.sessions[buffer]
  if not session then return end
  M.sessions[buffer] = nil
  for _, id in ipairs(session.autocmds or {}) do vim.api.nvim_del_autocmd(id) end
  if session.timer then session.timer:stop(); session.timer:close() end
  if session.job then
    send(session, { type = 'stop' })
    vim.fn.chanclose(session.job, 'stdin')
  end
end

function M.start(buffer)
  buffer = buffer or vim.api.nvim_get_current_buf()
  if M.sessions[buffer] then return end
  if not vim.api.nvim_buf_is_valid(buffer) or vim.bo[buffer].filetype ~= 'markdown' then return end
  local session = { buffer = buffer, output = '' }
  M.sessions[buffer] = session
  session.job = vim.fn.jobstart({ config.node or 'node', config.server or server_path }, {
    on_stdout = function(_, data)
      if M.sessions[buffer] ~= session then return end
      for index, part in ipairs(data) do
        session.output = session.output .. part
        if index < #data then
          local ok, reply = pcall(vim.fn.json_decode, session.output)
          if ok and type(reply) == 'table' and reply.url then
            session.url = reply.url
            if config.open_browser ~= false then
              vim.schedule(function()
                if M.sessions[buffer] == session then vim.ui.open(reply.url) end
              end)
            end
          end
          session.output = ''
        end
      end
    end,
    on_stderr = function(_, data) session.error = table.concat(data, '\n') end,
    on_exit = function() if M.sessions[buffer] == session then M.stop(buffer) end end,
  })
  if session.job <= 0 then M.sessions[buffer] = nil; return end
  send(session, { type = 'init', content = content(buffer) })
  session.timer = vim.uv.new_timer()
  vim.api.nvim_buf_attach(buffer, false, { on_lines = function()
    if M.sessions[buffer] ~= session then return true end
    session.timer:stop()
    session.timer:start(80, 0, vim.schedule_wrap(function()
      if M.sessions[buffer] == session and vim.api.nvim_buf_is_valid(buffer) and vim.bo[buffer].filetype == 'markdown' then
        send(session, { type = 'update', content = content(buffer) })
      end
    end))
  end })
  session.autocmds = {
    vim.api.nvim_create_autocmd('BufWipeout', { group = group, buffer = buffer, callback = function() M.stop(buffer) end }),
    vim.api.nvim_create_autocmd('FileType', { group = group, buffer = buffer, callback = function()
      if vim.bo[buffer].filetype ~= 'markdown' then M.stop(buffer) end
    end }),
  }
end

function M.setup(options)
  config = options or {}
  if group then
    for buffer in pairs(M.sessions) do M.stop(buffer) end
    vim.api.nvim_del_augroup_by_id(group)
  end
  group = vim.api.nvim_create_augroup('MdscopePreview', { clear = true })
  vim.api.nvim_create_user_command('MdscopeStart', function() M.start() end, { force = true })
  vim.api.nvim_create_user_command('MdscopeStop', function() M.stop() end, { force = true })
end

return M
