if vim.g.loaded_mdscope then return end
vim.g.loaded_mdscope = true
-- Register defaults on load; an explicit setup can replace them with custom options.
require('mdscope').setup()
