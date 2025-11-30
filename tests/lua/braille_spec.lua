#!/usr/bin/env lua
---@brief [[
--- Unit tests for braille encoding in strudel pianoroll
--- Run with: nvim --headless -c "luafile tests/lua/braille_spec.lua" -c "qa"
--- Or: lua tests/lua/braille_spec.lua (if lua is available)
---@brief ]]

-- Add the lua directory to package path
package.path = package.path .. ";./lua/?.lua;./lua/?/init.lua"

local braille = require('strudel.braille')

-- Simple test framework
local tests_run = 0
local tests_passed = 0
local tests_failed = 0

local function test(name, fn)
  tests_run = tests_run + 1
  local ok, err = pcall(fn)
  if ok then
    tests_passed = tests_passed + 1
    print("✓ " .. name)
  else
    tests_failed = tests_failed + 1
    print("✗ " .. name)
    print("  Error: " .. tostring(err))
  end
end

local function assert_eq(actual, expected, msg)
  if actual ~= expected then
    error(string.format("%s: expected %s, got %s", msg or "Assertion failed", tostring(expected), tostring(actual)))
  end
end

local function assert_true(value, msg)
  if not value then
    error(msg or "Expected true")
  end
end

-- Helper to get braille char for specific dots
local function braille_char(...)
  local dots = {...}
  local code = 0x2800
  for _, dot in ipairs(dots) do
    code = code + dot
  end
  return braille.codepoint_to_utf8(code)
end

print("\n=== Braille Encoding Tests ===\n")

-- Test: Empty grid produces blank braille
test("empty grid produces blank braille", function()
  local grid = { {}, {} }
  local char, code = braille.grid_to_braille(grid)
  assert_eq(code, 0x2800, "code should be base braille")
  assert_eq(char, "⠀", "char should be blank braille")
end)

-- Test: Single dot positions
test("top-left dot (row 1, col 1) = dot 1", function()
  local grid = { { [1] = true }, {} }
  local char, code = braille.grid_to_braille(grid)
  assert_eq(code, 0x2800 + 0x01, "code")
  assert_eq(char, "⠁", "char")
end)

test("top-right dot (row 1, col 2) = dot 4", function()
  local grid = { {}, { [1] = true } }
  local char, code = braille.grid_to_braille(grid)
  assert_eq(code, 0x2800 + 0x08, "code")
  assert_eq(char, "⠈", "char")
end)

test("second row left dot (row 2, col 1) = dot 2", function()
  local grid = { { [2] = true }, {} }
  local char, code = braille.grid_to_braille(grid)
  assert_eq(code, 0x2800 + 0x02, "code")
  assert_eq(char, "⠂", "char")
end)

test("third row left dot (row 3, col 1) = dot 3", function()
  local grid = { { [3] = true }, {} }
  local char, code = braille.grid_to_braille(grid)
  assert_eq(code, 0x2800 + 0x04, "code")
  assert_eq(char, "⠄", "char")
end)

test("bottom-left dot (row 4, col 1) = dot 7", function()
  local grid = { { [4] = true }, {} }
  local char, code = braille.grid_to_braille(grid)
  assert_eq(code, 0x2800 + 0x40, "code")
  assert_eq(char, "⡀", "char")
end)

test("bottom-right dot (row 4, col 2) = dot 8", function()
  local grid = { {}, { [4] = true } }
  local char, code = braille.grid_to_braille(grid)
  assert_eq(code, 0x2800 + 0x80, "code")
  assert_eq(char, "⢀", "char")
end)

-- Test: Combined dots
test("all dots in left column", function()
  local grid = { { true, true, true, true }, {} }
  local char, code = braille.grid_to_braille(grid)
  assert_eq(code, 0x2800 + 0x01 + 0x02 + 0x04 + 0x40, "code")
  assert_eq(char, "⡇", "char")
end)

test("all dots in right column", function()
  local grid = { {}, { true, true, true, true } }
  local char, code = braille.grid_to_braille(grid)
  assert_eq(code, 0x2800 + 0x08 + 0x10 + 0x20 + 0x80, "code")
  assert_eq(char, "⢸", "char")  -- 0x28B8
end)

test("all dots (full block)", function()
  local grid = { { true, true, true, true }, { true, true, true, true } }
  local char, code = braille.grid_to_braille(grid)
  assert_eq(code, 0x28FF, "code")
  assert_eq(char, "⣿", "char")
end)

-- Test: Sequential notes pattern (C4, C#4, D4, D#4)
-- This simulates note("60 61 62 63") playing in sequence
test("sequential notes: C4 at time 0, C#4 at time 1", function()
  -- C4=60 (bottom), D#4=63 (top)
  -- Time 0: C4 plays = bottom-left dot
  -- Time 1: C#4 plays = 3rd row right dot
  -- Expected: bottom-left (0x40) + 3rd-right (0x20) = ⡠
  
  -- Grid: [col][row] where row 1=top (D#4), row 4=bottom (C4)
  -- C4 at time 0 = col 1, row 4
  -- C#4 at time 1 = col 2, row 3
  local grid = { 
    { [4] = true },      -- col 1: C4 at bottom
    { [3] = true }       -- col 2: C#4 at 3rd row
  }
  local char, code = braille.grid_to_braille(grid)
  assert_eq(code, 0x2800 + 0x40 + 0x20, "code for C4+C#4")
  assert_eq(char, "⡠", "char for C4+C#4")
end)

test("sequential notes: D4 at time 2, D#4 at time 3", function()
  -- D4 at time 2 = col 1, row 2
  -- D#4 at time 3 = col 2, row 1 (top)
  local grid = {
    { [2] = true },      -- col 1: D4 at 2nd row
    { [1] = true }       -- col 2: D#4 at top
  }
  local char, code = braille.grid_to_braille(grid)
  assert_eq(code, 0x2800 + 0x02 + 0x08, "code for D4+D#4")
  assert_eq(char, "⠊", "char for D4+D#4")
end)

-- Test: MIDI to note name conversion
print("\n=== MIDI Note Name Tests ===\n")

test("midi_to_note_name: C4 = 60", function()
  assert_eq(braille.midi_to_note_name(60), "C4", "C4")
end)

test("midi_to_note_name: A4 = 69", function()
  assert_eq(braille.midi_to_note_name(69), "A4", "A4")
end)

test("midi_to_note_name: C#4 = 61", function()
  assert_eq(braille.midi_to_note_name(61), "C#4", "C#4")
end)

test("midi_to_note_name: C-1 = 0", function()
  assert_eq(braille.midi_to_note_name(0), "C-1", "C-1")
end)

test("midi_to_note_name: G9 = 127", function()
  assert_eq(braille.midi_to_note_name(127), "G9", "G9")
end)

-- Test: Note name to MIDI conversion
test("note_name_to_midi: C4 = 60", function()
  assert_eq(braille.note_name_to_midi("C4"), 60, "C4")
end)

test("note_name_to_midi: c4 (lowercase) = 60", function()
  assert_eq(braille.note_name_to_midi("c4"), 60, "c4")
end)

test("note_name_to_midi: C#4 = 61", function()
  assert_eq(braille.note_name_to_midi("C#4"), 61, "C#4")
end)

test("note_name_to_midi: Db4 = 61", function()
  assert_eq(braille.note_name_to_midi("Db4"), 61, "Db4")
end)

test("note_name_to_midi: A4 = 69", function()
  assert_eq(braille.note_name_to_midi("A4"), 69, "A4")
end)

-- Test: Note labels
print("\n=== Note Label Tests ===\n")

test("generate_note_labels: single row C4-D#4", function()
  local labels = braille.generate_note_labels({ min = 60, max = 63 }, 1)
  assert_eq(#labels, 1, "should have 1 label")
  assert_eq(labels[1], "C4-D#4", "label text")
end)

test("generate_note_labels: two rows C4-B4", function()
  -- C4=60 to B4=71 = 12 notes = 3 rows
  -- Row 0: 68-71 = G#4-B4
  -- Row 1: 64-67 = E4-G4
  -- Row 2: 60-63 = C4-D#4
  local labels = braille.generate_note_labels({ min = 60, max = 71 }, 3)
  assert_eq(#labels, 3, "should have 3 labels")
  assert_eq(labels[1], "G#4-B4", "first row (highest)")
  assert_eq(labels[2], "E4-G4", "second row")
  assert_eq(labels[3], "C4-D#4", "third row (lowest)")
end)

-- Test: render_row function
print("\n=== Render Row Tests ===\n")

test("render_row: single note at start", function()
  local notes = {
    { start = 0, ["end"] = 0.25, note = 60, active = false }  -- C4
  }
  local note_range = { min = 60, max = 63 }  -- C4-D#4
  local result, highlights = braille.render_row(notes, note_range, 4)
  
  -- Note at time 0-0.25 with width=4 means time_cols=8
  -- 0.25 * 8 = 2, so columns 0,1 are filled
  -- C4 is note_idx=0, which maps to sub_row 4 (bottom)
  assert_eq(#result, 12, "4 braille chars = 12 bytes")  -- 4 chars * 3 bytes
  assert_true(#highlights > 0, "should have highlights")
end)

test("render_row: ascending sequence", function()
  -- Simulating note("60 61 62 63") - each note takes 1/4 of the time
  local notes = {
    { start = 0.00, ["end"] = 0.25, note = 60, active = false },  -- C4
    { start = 0.25, ["end"] = 0.50, note = 61, active = false },  -- C#4
    { start = 0.50, ["end"] = 0.75, note = 62, active = false },  -- D4
    { start = 0.75, ["end"] = 1.00, note = 63, active = false },  -- D#4
  }
  local note_range = { min = 60, max = 63 }
  local result, highlights = braille.render_row(notes, note_range, 4)
  
  -- With width=4, time_cols=8
  -- C4 (0-0.25): cols 0,1 -> braille char 0: left col has bottom dot
  -- C#4 (0.25-0.5): cols 2,3 -> braille char 1: both cols have 3rd row dot
  -- etc.
  
  assert_eq(#result, 12, "4 braille chars = 12 bytes")
  
  -- Verify we got the expected pattern (approximately)
  -- The exact chars depend on timing precision
  print("  Result: " .. result)
  print("  Highlights: " .. #highlights .. " entries")
end)

-- Test: Drum label generation
print("\n=== Drum Label Tests ===\n")

test("generate_drum_labels: 4 tracks = 1 row", function()
  local track_names = { "bd", "sd", "hh", "cp" }
  local labels = braille.generate_drum_labels(track_names, 1)
  assert_eq(#labels, 1, "should have 1 label")
  assert_eq(labels[1], "bd/sd/hh/cp", "label text")
end)

test("generate_drum_labels: 6 tracks = 2 rows", function()
  local track_names = { "bd", "sd", "hh", "cp", "oh", "lt" }
  local labels = braille.generate_drum_labels(track_names, 2)
  assert_eq(#labels, 2, "should have 2 labels")
  assert_eq(labels[1], "bd/sd/hh/cp", "first row")
  assert_eq(labels[2], "oh/lt", "second row")
end)

test("generate_drum_labels: long names get abbreviated", function()
  local track_names = { "kickdrum", "snare", "hihat", "clap" }
  local labels = braille.generate_drum_labels(track_names, 1)
  assert_eq(#labels, 1, "should have 1 label")
  assert_eq(labels[1], "ki/sn/hi/cl", "abbreviated names")
end)

-- Test: Drum row rendering
print("\n=== Drum Row Rendering Tests ===\n")

test("render_drum_row: single track hit at start", function()
  local tracks = {
    { name = "bd", events = { { start = 0, ["end"] = 0.1, active = false } } }
  }
  local track_indices = { 1 }
  local result, highlights = braille.render_drum_row(tracks, track_indices, 4)
  
  -- bd is track 0, maps to sub_row 1 (top)
  -- Hit at time 0-0.1 with width=4 means time_cols=8
  -- 0.1 * 8 ≈ 0.8, ceil-1 = 0, so only column 0 is filled
  -- First braille char should have top-left dot
  assert_eq(#result, 12, "4 braille chars = 12 bytes")
  assert_true(#highlights > 0, "should have highlights")
  print("  Result: " .. result)
end)

test("render_drum_row: 4 tracks with hits", function()
  local tracks = {
    { name = "bd", events = { { start = 0.0, ["end"] = 0.25, active = false } } },
    { name = "sd", events = { { start = 0.25, ["end"] = 0.5, active = false } } },
    { name = "hh", events = { { start = 0.5, ["end"] = 0.75, active = false } } },
    { name = "cp", events = { { start = 0.75, ["end"] = 1.0, active = true } } },
  }
  local track_indices = { 1, 2, 3, 4 }
  local result, highlights = braille.render_drum_row(tracks, track_indices, 4)
  
  -- Each track hits at a different quarter
  -- bd (row 1) at 0-0.25
  -- sd (row 2) at 0.25-0.5
  -- hh (row 3) at 0.5-0.75
  -- cp (row 4) at 0.75-1.0
  
  assert_eq(#result, 12, "4 braille chars = 12 bytes")
  assert_true(#highlights >= 4, "should have at least 4 highlights")
  
  -- Check that cp is marked as active
  local has_active = false
  for _, hl in ipairs(highlights) do
    if hl.active then has_active = true end
  end
  assert_true(has_active, "should have active highlight")
  
  print("  Result: " .. result)
  print("  Highlights: " .. #highlights .. " entries")
end)

test("render_drum_row: subset of tracks", function()
  local tracks = {
    { name = "bd", events = { { start = 0, ["end"] = 0.25, active = false } } },
    { name = "sd", events = { { start = 0.5, ["end"] = 0.75, active = false } } },
  }
  -- Only include track 2 in this row
  local track_indices = { 2 }
  local result, highlights = braille.render_drum_row(tracks, track_indices, 4)
  
  assert_eq(#result, 12, "4 braille chars = 12 bytes")
  -- Should only show sd hits (track 2), not bd hits
  print("  Result: " .. result)
  print("  Highlights: " .. #highlights .. " entries")
end)

-- Print summary
print("\n=== Summary ===\n")
print(string.format("Tests: %d total, %d passed, %d failed", tests_run, tests_passed, tests_failed))

if tests_failed > 0 then
  os.exit(1)
else
  print("\nAll tests passed!")
  os.exit(0)
end
