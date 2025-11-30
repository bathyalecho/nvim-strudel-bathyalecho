---@brief [[
--- Braille character encoding for pianoroll visualization
--- Each braille char is a 2x4 grid representing 4 notes × 2 time positions
---@brief ]]

local M = {}

-- Braille character encoding
-- Each braille char is a 2x4 grid of dots:
--   1 4    (bits: 0x01, 0x08)  <- top (row 1)
--   2 5    (bits: 0x02, 0x10)
--   3 6    (bits: 0x04, 0x20)
--   7 8    (bits: 0x40, 0x80)  <- bottom (row 4)
-- Base character is U+2800 (empty braille)
M.BRAILLE_BASE = 0x2800

-- Dot bit values indexed by [column][row]
-- Column 1 = left (time position 0), Column 2 = right (time position 1)
-- Row 1 = top, Row 4 = bottom
M.BRAILLE_DOTS = {
  -- Left column (time position 0): rows 1-4 from top to bottom
  { 0x01, 0x02, 0x04, 0x40 },
  -- Right column (time position 1): rows 1-4 from top to bottom
  { 0x08, 0x10, 0x20, 0x80 },
}

---Convert a code point to UTF-8 string
---@param code number Unicode code point
---@return string UTF-8 encoded string
function M.codepoint_to_utf8(code)
  if code < 0x80 then
    return string.char(code)
  elseif code < 0x800 then
    return string.char(
      0xC0 + math.floor(code / 64),
      0x80 + (code % 64)
    )
  else
    return string.char(
      0xE0 + math.floor(code / 4096),
      0x80 + math.floor((code % 4096) / 64),
      0x80 + (code % 64)
    )
  end
end

---Convert note grid to braille character
---@param grid boolean[][] 2x4 grid [col][row] where col=1,2 and row=1-4
---@return string Single braille character
---@return number The code point used
function M.grid_to_braille(grid)
  local code = M.BRAILLE_BASE
  for col = 1, 2 do
    for row = 1, 4 do
      if grid[col] and grid[col][row] then
        code = code + M.BRAILLE_DOTS[col][row]
      end
    end
  end
  return M.codepoint_to_utf8(code), code
end

---Convert MIDI note number to note name
---@param midi number MIDI note number (0-127)
---@return string Note name like "C4", "D#5"
function M.midi_to_note_name(midi)
  local note_names = { 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B' }
  local octave = math.floor(midi / 12) - 1
  local note = note_names[(midi % 12) + 1]
  return note .. octave
end

---Convert note name to MIDI number
---@param name string Note name like "C4", "d#5", "Bb3"
---@return number|nil MIDI note number or nil if invalid
function M.note_name_to_midi(name)
  local note_map = {
    C = 0, c = 0,
    D = 2, d = 2,
    E = 4, e = 4,
    F = 5, f = 5,
    G = 7, g = 7,
    A = 9, a = 9,
    B = 11, b = 11,
  }
  
  local note_char = name:sub(1, 1)
  local base = note_map[note_char]
  if not base then return nil end
  
  local rest = name:sub(2)
  local modifier = 0
  
  if rest:sub(1, 1) == '#' then
    modifier = 1
    rest = rest:sub(2)
  elseif rest:sub(1, 1) == 'b' then
    modifier = -1
    rest = rest:sub(2)
  end
  
  local octave = tonumber(rest)
  if not octave then return nil end
  
  return (octave + 1) * 12 + base + modifier
end

---Generate note labels for braille rows
---@param note_range table {min, max} MIDI note range
---@param num_rows number Number of braille rows
---@return string[] labels Array of label strings
function M.generate_note_labels(note_range, num_rows)
  local labels = {}
  local max_note = note_range.max

  for row = 0, num_rows - 1 do
    local top_note = max_note - (row * 4)
    local bottom_note = math.max(note_range.min, top_note - 3)
    local label = M.midi_to_note_name(top_note)
    if top_note ~= bottom_note then
      label = M.midi_to_note_name(bottom_note) .. '-' .. M.midi_to_note_name(top_note)
    end
    table.insert(labels, label)
  end

  return labels
end

---Render notes as braille string for a single row
---@param notes table[] Array of {start, end, note, active} events
---@param note_range table {min, max} range for this row (4 notes)
---@param width number Number of braille characters
---@return string Braille string
---@return table[] Highlight info
function M.render_row(notes, note_range, width)
  local min_note = note_range.min
  local max_note = note_range.max
  local time_cols = width * 2
  
  -- Build time grid for this row's notes
  local grid = {}
  for n = 0, 3 do
    grid[n] = {}
  end
  
  for _, event in ipairs(notes) do
    if event.note and event.note >= min_note and event.note <= max_note then
      local note_idx = event.note - min_note
      local start_col = math.floor(event.start * time_cols)
      local end_col = math.ceil(event['end'] * time_cols) - 1
      for t = math.max(0, start_col), math.min(time_cols - 1, end_col) do
        grid[note_idx][t] = { on = true, active = event.active }
      end
    end
  end
  
  local chars = {}
  local highlights = {}
  
  for col = 0, width - 1 do
    local t0 = col * 2
    local t1 = col * 2 + 1
    
    local braille_grid = { {}, {} }
    local has_active = false
    local has_any = false
    
    -- Map notes to braille rows (top = highest note)
    for sub_row = 1, 4 do
      local note_idx = (max_note - min_note) - (sub_row - 1)
      if note_idx >= 0 and note_idx <= 3 then
        if grid[note_idx] and grid[note_idx][t0] then
          braille_grid[1][sub_row] = true
          has_any = true
          if grid[note_idx][t0].active then has_active = true end
        end
        if grid[note_idx] and grid[note_idx][t1] then
          braille_grid[2][sub_row] = true
          has_any = true
          if grid[note_idx][t1].active then has_active = true end
        end
      end
    end
    
    local char = M.grid_to_braille(braille_grid)
    table.insert(chars, char)
    
    if has_any then
      table.insert(highlights, {
        col = col,
        active = has_active,
      })
    end
  end
  
  return table.concat(chars), highlights
end

---Generate drum track labels for braille rows
---Groups 4 track names per row
---@param track_names string[] Array of track names (sorted)
---@param num_rows number Number of braille rows
---@return string[] labels Array of label strings
function M.generate_drum_labels(track_names, num_rows)
  local labels = {}
  
  for row = 0, num_rows - 1 do
    local start_idx = row * 4 + 1
    local row_names = {}
    
    for i = 0, 3 do
      local idx = start_idx + i
      if idx <= #track_names then
        -- Abbreviate long names (take first 2 chars)
        local name = track_names[idx]
        if #name > 2 then
          name = name:sub(1, 2)
        end
        table.insert(row_names, name)
      end
    end
    
    table.insert(labels, table.concat(row_names, '/'))
  end
  
  return labels
end

---Render drum tracks as braille string for a single row
---@param tracks table[] Array of {name, events} where events = {start, end, active}
---@param track_indices number[] Which track indices (1-based) belong to this row (up to 4)
---@param width number Number of braille characters
---@return string Braille string
---@return table[] Highlight info
function M.render_drum_row(tracks, track_indices, width)
  local time_cols = width * 2
  
  -- Build time grid for this row's tracks (up to 4)
  -- grid[track_in_row (0-3)][time_col] = {on, active}
  local grid = {}
  for i = 0, 3 do
    grid[i] = {}
  end
  
  for row_idx, track_idx in ipairs(track_indices) do
    local track = tracks[track_idx]
    if track and track.events then
      local grid_idx = row_idx - 1 -- 0-based
      for _, event in ipairs(track.events) do
        local start_col = math.floor(event.start * time_cols)
        local end_col = math.ceil(event['end'] * time_cols) - 1
        for t = math.max(0, start_col), math.min(time_cols - 1, end_col) do
          grid[grid_idx][t] = { on = true, active = event.active }
        end
      end
    end
  end
  
  local chars = {}
  local highlights = {}
  
  for col = 0, width - 1 do
    local t0 = col * 2
    local t1 = col * 2 + 1
    
    local braille_grid = { {}, {} }
    local has_active = false
    local has_any = false
    
    -- Map tracks to braille rows (row 1 = first track = top)
    for sub_row = 1, 4 do
      local track_in_row = sub_row - 1 -- 0-based
      if grid[track_in_row] then
        if grid[track_in_row][t0] then
          braille_grid[1][sub_row] = true
          has_any = true
          if grid[track_in_row][t0].active then has_active = true end
        end
        if grid[track_in_row][t1] then
          braille_grid[2][sub_row] = true
          has_any = true
          if grid[track_in_row][t1].active then has_active = true end
        end
      end
    end
    
    local char = M.grid_to_braille(braille_grid)
    table.insert(chars, char)
    
    if has_any then
      table.insert(highlights, {
        col = col,
        active = has_active,
      })
    end
  end
  
  return table.concat(chars), highlights
end

return M
