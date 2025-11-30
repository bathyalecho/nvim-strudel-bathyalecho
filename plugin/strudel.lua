-- nvim-strudel - Live coding music in Neovim
-- License: AGPL-3.0

if vim.g.loaded_strudel then
  return
end
vim.g.loaded_strudel = true

-- Lazy-load the plugin - actual setup happens when user calls require('strudel').setup()
