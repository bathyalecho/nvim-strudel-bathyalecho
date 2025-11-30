#!/usr/bin/env node
/**
 * LSP server for Strudel mini-notation
 * Provides completions, hover, diagnostics, signature help, and code actions
 */

import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
  InitializeResult,
  CompletionItem,
  CompletionItemKind,
  Hover,
  Diagnostic,
  DiagnosticSeverity,
  Position,
  Range,
  SignatureHelp,
  SignatureInformation,
  ParameterInformation,
  CodeAction,
  CodeActionKind,
  CodeActionParams,
  TextEdit,
  MarkupKind,
} from 'vscode-languageserver/node.js';

import { TextDocument } from 'vscode-languageserver-textdocument';

// Create connection using stdio
const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// Dynamic sample list - will be populated from engine
let dynamicSamples: string[] = [];
let dynamicBanks: string[] = [];

// Default sample names (fallback when not connected to engine)
const DEFAULT_SAMPLE_NAMES = [
  // Drums
  'bd', 'sd', 'hh', 'oh', 'cp', 'mt', 'ht', 'lt', 'rim', 'cb', 'cr', 'rd', 'sh', 'tb', 'perc', 'misc', 'fx',
  // Piano
  'piano',
  // Synths
  'sine', 'saw', 'square', 'triangle', 'sawtooth', 'tri', 'white', 'pink', 'brown',
  // Misc samples
  'casio', 'jazz', 'metal', 'east', 'space', 'wind', 'insect', 'crow', 'numbers', 'mridangam',
  // Instruments from VCSL
  'violin', 'viola', 'cello', 'bass', 'flute', 'oboe', 'clarinet', 'bassoon',
  'trumpet', 'horn', 'trombone', 'tuba', 'glockenspiel', 'xylophone', 'vibraphone',
];

// Note names
const NOTE_NAMES = [
  'c', 'd', 'e', 'f', 'g', 'a', 'b',
  'cs', 'ds', 'fs', 'gs', 'as', // sharps
  'db', 'eb', 'gb', 'ab', 'bb', // flats
];

// Octaves
const OCTAVES = ['0', '1', '2', '3', '4', '5', '6', '7', '8'];

// Scale names
const SCALE_NAMES = [
  'major', 'minor', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'locrian', 'aeolian', 'ionian',
  'harmonicMinor', 'melodicMinor', 'pentatonic', 'blues', 'chromatic',
  'wholetone', 'diminished', 'augmented', 'bebop', 'hungarian', 'spanish',
];

// Effects/modifiers in mini-notation
const MINI_OPERATORS = [
  { label: '*', detail: 'Speed up (fast)', documentation: 'Multiply speed: bd*2 plays twice as fast' },
  { label: '/', detail: 'Slow down', documentation: 'Divide speed: bd/2 plays twice as slow' },
  { label: '!', detail: 'Replicate', documentation: 'Repeat element: bd!3 plays bd three times' },
  { label: '?', detail: 'Degrade/maybe', documentation: 'Random chance: bd? sometimes plays' },
  { label: '@', detail: 'Weight', documentation: 'Set duration weight: bd@2 takes twice as long' },
  { label: '~', detail: 'Rest/silence', documentation: 'Silent step' },
  { label: '<>', detail: 'Alternate', documentation: 'Alternate between patterns each cycle' },
  { label: '[]', detail: 'Subsequence', documentation: 'Group elements into subsequence' },
  { label: '{}', detail: 'Polyrhythm', documentation: 'Play patterns in parallel with different lengths' },
  { label: '(,)', detail: 'Euclidean rhythm', documentation: 'Euclidean distribution: bd(3,8) = 3 hits over 8 steps' },
  { label: ':', detail: 'Sample index', documentation: 'Select sample variant: bd:2' },
  { label: ',', detail: 'Parallel', documentation: 'Play patterns in parallel: bd, hh' },
  { label: '|', detail: 'Random choice', documentation: 'Random choice: bd | sd' },
];

// Function signatures with parameters
interface FunctionSignature {
  name: string;
  detail: string;
  documentation: string;
  signatures: {
    label: string;
    documentation?: string;
    parameters: { label: string; documentation: string }[];
  }[];
}

const STRUDEL_FUNCTIONS: FunctionSignature[] = [
  {
    name: 's',
    detail: 'Sound/sample',
    documentation: 'Play a sound or sample',
    signatures: [{
      label: 's(pattern)',
      parameters: [{ label: 'pattern', documentation: 'Mini-notation pattern of sample names, e.g., "bd sd hh"' }],
    }],
  },
  {
    name: 'sound',
    detail: 'Sound/sample (alias for s)',
    documentation: 'Play a sound or sample',
    signatures: [{
      label: 'sound(pattern)',
      parameters: [{ label: 'pattern', documentation: 'Mini-notation pattern of sample names' }],
    }],
  },
  {
    name: 'n',
    detail: 'Note number',
    documentation: 'Set note by MIDI number or pattern',
    signatures: [{
      label: 'n(pattern)',
      parameters: [{ label: 'pattern', documentation: 'Pattern of MIDI note numbers, e.g., "0 2 4 7"' }],
    }],
  },
  {
    name: 'note',
    detail: 'Note name',
    documentation: 'Set note by name',
    signatures: [{
      label: 'note(pattern)',
      parameters: [{ label: 'pattern', documentation: 'Pattern of note names, e.g., "c4 e4 g4"' }],
    }],
  },
  {
    name: 'fast',
    detail: 'Speed up pattern',
    documentation: 'Speed up the pattern by a factor',
    signatures: [{
      label: 'fast(factor)',
      parameters: [{ label: 'factor', documentation: 'Speed multiplier (2 = twice as fast)' }],
    }],
  },
  {
    name: 'slow',
    detail: 'Slow down pattern',
    documentation: 'Slow down the pattern by a factor',
    signatures: [{
      label: 'slow(factor)',
      parameters: [{ label: 'factor', documentation: 'Speed divisor (2 = twice as slow)' }],
    }],
  },
  {
    name: 'gain',
    detail: 'Volume',
    documentation: 'Set the volume/gain',
    signatures: [{
      label: 'gain(amount)',
      parameters: [{ label: 'amount', documentation: 'Volume level (0-1, can go higher for boost)' }],
    }],
  },
  {
    name: 'pan',
    detail: 'Stereo pan',
    documentation: 'Set stereo panning',
    signatures: [{
      label: 'pan(position)',
      parameters: [{ label: 'position', documentation: 'Pan position (0 = left, 0.5 = center, 1 = right)' }],
    }],
  },
  {
    name: 'speed',
    detail: 'Playback speed',
    documentation: 'Change sample playback speed (affects pitch)',
    signatures: [{
      label: 'speed(rate)',
      parameters: [{ label: 'rate', documentation: 'Playback rate (1 = normal, 2 = octave up, 0.5 = octave down, negative = reverse)' }],
    }],
  },
  {
    name: 'lpf',
    detail: 'Low-pass filter',
    documentation: 'Apply a low-pass filter',
    signatures: [{
      label: 'lpf(frequency)',
      parameters: [{ label: 'frequency', documentation: 'Cutoff frequency in Hz (e.g., 1000)' }],
    }, {
      label: 'lpf(frequency, resonance)',
      parameters: [
        { label: 'frequency', documentation: 'Cutoff frequency in Hz' },
        { label: 'resonance', documentation: 'Filter resonance (Q factor)' },
      ],
    }],
  },
  {
    name: 'hpf',
    detail: 'High-pass filter',
    documentation: 'Apply a high-pass filter',
    signatures: [{
      label: 'hpf(frequency)',
      parameters: [{ label: 'frequency', documentation: 'Cutoff frequency in Hz (e.g., 200)' }],
    }, {
      label: 'hpf(frequency, resonance)',
      parameters: [
        { label: 'frequency', documentation: 'Cutoff frequency in Hz' },
        { label: 'resonance', documentation: 'Filter resonance (Q factor)' },
      ],
    }],
  },
  {
    name: 'bpf',
    detail: 'Band-pass filter',
    documentation: 'Apply a band-pass filter',
    signatures: [{
      label: 'bpf(frequency)',
      parameters: [{ label: 'frequency', documentation: 'Center frequency in Hz' }],
    }, {
      label: 'bpf(frequency, resonance)',
      parameters: [
        { label: 'frequency', documentation: 'Center frequency in Hz' },
        { label: 'resonance', documentation: 'Filter resonance (Q factor, affects bandwidth)' },
      ],
    }],
  },
  {
    name: 'delay',
    detail: 'Delay effect',
    documentation: 'Add a delay/echo effect',
    signatures: [{
      label: 'delay(amount)',
      parameters: [{ label: 'amount', documentation: 'Delay wet/dry mix (0-1)' }],
    }, {
      label: 'delay(amount, time, feedback)',
      parameters: [
        { label: 'amount', documentation: 'Wet/dry mix (0-1)' },
        { label: 'time', documentation: 'Delay time in cycles (e.g., 0.5)' },
        { label: 'feedback', documentation: 'Feedback amount (0-1)' },
      ],
    }],
  },
  {
    name: 'room',
    detail: 'Reverb',
    documentation: 'Add reverb effect',
    signatures: [{
      label: 'room(size)',
      parameters: [{ label: 'size', documentation: 'Room size / reverb amount (0-1)' }],
    }],
  },
  {
    name: 'crush',
    detail: 'Bitcrush',
    documentation: 'Apply bitcrusher effect',
    signatures: [{
      label: 'crush(bits)',
      parameters: [{ label: 'bits', documentation: 'Bit depth (1-16, lower = more crushed)' }],
    }],
  },
  {
    name: 'coarse',
    detail: 'Sample rate reduction',
    documentation: 'Reduce sample rate for lo-fi effect',
    signatures: [{
      label: 'coarse(amount)',
      parameters: [{ label: 'amount', documentation: 'Reduction factor (higher = more aliasing)' }],
    }],
  },
  {
    name: 'vowel',
    detail: 'Vowel filter',
    documentation: 'Apply vowel formant filter',
    signatures: [{
      label: 'vowel(pattern)',
      parameters: [{ label: 'pattern', documentation: 'Pattern of vowels: a, e, i, o, u' }],
    }],
  },
  {
    name: 'euclid',
    detail: 'Euclidean rhythm',
    documentation: 'Apply Euclidean rhythm distribution',
    signatures: [{
      label: 'euclid(pulses, steps)',
      parameters: [
        { label: 'pulses', documentation: 'Number of pulses/hits' },
        { label: 'steps', documentation: 'Total number of steps' },
      ],
    }, {
      label: 'euclid(pulses, steps, rotation)',
      parameters: [
        { label: 'pulses', documentation: 'Number of pulses/hits' },
        { label: 'steps', documentation: 'Total number of steps' },
        { label: 'rotation', documentation: 'Rotation offset' },
      ],
    }],
  },
  {
    name: 'every',
    detail: 'Apply every N cycles',
    documentation: 'Apply a function every N cycles',
    signatures: [{
      label: 'every(n, function)',
      parameters: [
        { label: 'n', documentation: 'Number of cycles' },
        { label: 'function', documentation: 'Function to apply, e.g., rev or fast(2)' },
      ],
    }],
  },
  {
    name: 'rev',
    detail: 'Reverse',
    documentation: 'Reverse the pattern',
    signatures: [{
      label: 'rev()',
      parameters: [],
    }],
  },
  {
    name: 'jux',
    detail: 'Juxtapose',
    documentation: 'Apply function to right channel only',
    signatures: [{
      label: 'jux(function)',
      parameters: [{ label: 'function', documentation: 'Function to apply to right channel' }],
    }],
  },
  {
    name: 'stack',
    detail: 'Stack patterns',
    documentation: 'Play multiple patterns simultaneously',
    signatures: [{
      label: 'stack(pattern1, pattern2, ...)',
      parameters: [{ label: 'patterns', documentation: 'Patterns to play in parallel' }],
    }],
  },
  {
    name: 'cat',
    detail: 'Concatenate',
    documentation: 'Play patterns in sequence',
    signatures: [{
      label: 'cat(pattern1, pattern2, ...)',
      parameters: [{ label: 'patterns', documentation: 'Patterns to play in sequence' }],
    }],
  },
  {
    name: 'sometimes',
    detail: 'Apply sometimes (50%)',
    documentation: 'Apply function with 50% probability',
    signatures: [{
      label: 'sometimes(function)',
      parameters: [{ label: 'function', documentation: 'Function to sometimes apply' }],
    }],
  },
  {
    name: 'often',
    detail: 'Apply often (75%)',
    documentation: 'Apply function with 75% probability',
    signatures: [{
      label: 'often(function)',
      parameters: [{ label: 'function', documentation: 'Function to often apply' }],
    }],
  },
  {
    name: 'rarely',
    detail: 'Apply rarely (25%)',
    documentation: 'Apply function with 25% probability',
    signatures: [{
      label: 'rarely(function)',
      parameters: [{ label: 'function', documentation: 'Function to rarely apply' }],
    }],
  },
  {
    name: 'almostAlways',
    detail: 'Apply almost always (90%)',
    documentation: 'Apply function with 90% probability',
    signatures: [{
      label: 'almostAlways(function)',
      parameters: [{ label: 'function', documentation: 'Function to almost always apply' }],
    }],
  },
  {
    name: 'almostNever',
    detail: 'Apply almost never (10%)',
    documentation: 'Apply function with 10% probability',
    signatures: [{
      label: 'almostNever(function)',
      parameters: [{ label: 'function', documentation: 'Function to almost never apply' }],
    }],
  },
  {
    name: 'bank',
    detail: 'Sample bank',
    documentation: 'Set the sample bank (drum machine)',
    signatures: [{
      label: 'bank(name)',
      parameters: [{ label: 'name', documentation: 'Bank name, e.g., "RolandTR808" or "TR808"' }],
    }],
  },
  {
    name: 'scale',
    detail: 'Musical scale',
    documentation: 'Quantize notes to a scale',
    signatures: [{
      label: 'scale(name)',
      parameters: [{ label: 'name', documentation: 'Scale name, e.g., "major", "minor", "dorian"' }],
    }],
  },
  {
    name: 'struct',
    detail: 'Structure',
    documentation: 'Apply rhythmic structure from another pattern',
    signatures: [{
      label: 'struct(pattern)',
      parameters: [{ label: 'pattern', documentation: 'Boolean pattern for rhythm, e.g., "t f t f"' }],
    }],
  },
  {
    name: 'mask',
    detail: 'Mask pattern',
    documentation: 'Mask pattern with boolean pattern',
    signatures: [{
      label: 'mask(pattern)',
      parameters: [{ label: 'pattern', documentation: 'Boolean pattern to mask with' }],
    }],
  },
  {
    name: 'clip',
    detail: 'Clip duration',
    documentation: 'Multiply event duration',
    signatures: [{
      label: 'clip(factor)',
      parameters: [{ label: 'factor', documentation: 'Duration multiplier (1 = full, 0.5 = half)' }],
    }],
  },
  {
    name: 'attack',
    detail: 'Attack time',
    documentation: 'Set envelope attack time',
    signatures: [{
      label: 'attack(time)',
      parameters: [{ label: 'time', documentation: 'Attack time in seconds' }],
    }],
  },
  {
    name: 'decay',
    detail: 'Decay time',
    documentation: 'Set envelope decay time',
    signatures: [{
      label: 'decay(time)',
      parameters: [{ label: 'time', documentation: 'Decay time in seconds' }],
    }],
  },
  {
    name: 'sustain',
    detail: 'Sustain level',
    documentation: 'Set envelope sustain level',
    signatures: [{
      label: 'sustain(level)',
      parameters: [{ label: 'level', documentation: 'Sustain level (0-1)' }],
    }],
  },
  {
    name: 'release',
    detail: 'Release time',
    documentation: 'Set envelope release time',
    signatures: [{
      label: 'release(time)',
      parameters: [{ label: 'time', documentation: 'Release time in seconds' }],
    }],
  },
  {
    name: 'begin',
    detail: 'Sample start',
    documentation: 'Set sample playback start position',
    signatures: [{
      label: 'begin(position)',
      parameters: [{ label: 'position', documentation: 'Start position (0-1, 0 = beginning)' }],
    }],
  },
  {
    name: 'end',
    detail: 'Sample end',
    documentation: 'Set sample playback end position',
    signatures: [{
      label: 'end(position)',
      parameters: [{ label: 'position', documentation: 'End position (0-1, 1 = end)' }],
    }],
  },
  {
    name: 'cut',
    detail: 'Cut group',
    documentation: 'Stop other sounds in same cut group (like hi-hat choke)',
    signatures: [{
      label: 'cut(group)',
      parameters: [{ label: 'group', documentation: 'Cut group number' }],
    }],
  },
  {
    name: 'chop',
    detail: 'Chop sample',
    documentation: 'Chop sample into N parts for granular effects',
    signatures: [{
      label: 'chop(parts)',
      parameters: [{ label: 'parts', documentation: 'Number of parts to chop into' }],
    }],
  },
  {
    name: 'slice',
    detail: 'Slice sample',
    documentation: 'Slice sample and select which slice to play',
    signatures: [{
      label: 'slice(total, which)',
      parameters: [
        { label: 'total', documentation: 'Total number of slices' },
        { label: 'which', documentation: 'Pattern of slice indices to play' },
      ],
    }],
  },
  {
    name: 'loopAt',
    detail: 'Loop at cycles',
    documentation: 'Adjust sample speed to loop over N cycles',
    signatures: [{
      label: 'loopAt(cycles)',
      parameters: [{ label: 'cycles', documentation: 'Number of cycles for the loop' }],
    }],
  },
  {
    name: 'fit',
    detail: 'Fit to cycle',
    documentation: 'Fit sample to event duration',
    signatures: [{
      label: 'fit()',
      parameters: [],
    }],
  },
  {
    name: 'striate',
    detail: 'Striate',
    documentation: 'Granular time-stretch effect',
    signatures: [{
      label: 'striate(parts)',
      parameters: [{ label: 'parts', documentation: 'Number of parts to striate into' }],
    }],
  },
  {
    name: 'orbit',
    detail: 'Effect bus',
    documentation: 'Route to effect bus (for shared effects)',
    signatures: [{
      label: 'orbit(bus)',
      parameters: [{ label: 'bus', documentation: 'Effect bus number (0-11)' }],
    }],
  },
];

// Common typos and their corrections
const TYPO_CORRECTIONS: Record<string, string> = {
  // Sample typos
  'db': 'bd',
  'ds': 'sd',
  'kick': 'bd',
  'snare': 'sd',
  'hihat': 'hh',
  'openhat': 'oh',
  'clap': 'cp',
  'cowbell': 'cb',
  'crash': 'cr',
  'ride': 'rd',
  // Note typos
  'cf': 'c',
  'ef': 'e',
  'bf': 'b',
  // Function typos
  'sounds': 'sound',
  'notes': 'note',
  'filters': 'lpf',
  'lowpass': 'lpf',
  'highpass': 'hpf',
  'bandpass': 'bpf',
  'reverb': 'room',
  'echo': 'delay',
  'volume': 'gain',
  'reverse': 'rev',
};

/**
 * Get all available samples (dynamic + defaults)
 */
function getAllSamples(): string[] {
  if (dynamicSamples.length > 0) {
    return dynamicSamples;
  }
  return DEFAULT_SAMPLE_NAMES;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];
  
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[b.length][a.length];
}

/**
 * Find similar words for typo suggestions
 */
function findSimilar(word: string, candidates: string[], maxDistance = 2): string[] {
  const lowerWord = word.toLowerCase();
  
  // Check explicit typo corrections first
  if (TYPO_CORRECTIONS[lowerWord]) {
    return [TYPO_CORRECTIONS[lowerWord]];
  }
  
  // Find candidates within edit distance
  const similar: { word: string; distance: number }[] = [];
  for (const candidate of candidates) {
    const distance = levenshtein(lowerWord, candidate.toLowerCase());
    if (distance <= maxDistance && distance > 0) {
      similar.push({ word: candidate, distance });
    }
  }
  
  // Sort by distance and return top matches
  return similar
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
    .map(s => s.word);
}

// Store diagnostics with their data for code actions
interface DiagnosticData {
  type: 'unknown_sample' | 'unbalanced_bracket' | 'unknown_function';
  word?: string;
  suggestions?: string[];
}

const diagnosticDataMap = new Map<string, Map<string, DiagnosticData>>();

connection.onInitialize((params: InitializeParams): InitializeResult => {
  connection.console.log('Strudel LSP initializing...');
  
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        triggerCharacters: ['"', "'", ' ', ':', '(', '.', ','],
        resolveProvider: true,
      },
      hoverProvider: true,
      signatureHelpProvider: {
        triggerCharacters: ['(', ','],
        retriggerCharacters: [','],
      },
      codeActionProvider: {
        codeActionKinds: [CodeActionKind.QuickFix],
      },
    },
  };
});

connection.onInitialized(() => {
  connection.console.log('Strudel LSP initialized');
  
  // Try to connect to strudel server to get dynamic samples
  tryConnectToEngine();
});

/**
 * Try to connect to the strudel engine to get dynamic sample list
 */
async function tryConnectToEngine() {
  try {
    // Try to connect via WebSocket to get sample list
    const WebSocket = (await import('ws')).default;
    const ws = new WebSocket('ws://127.0.0.1:37812');
    
    ws.on('open', () => {
      connection.console.log('Connected to Strudel engine for sample list');
      ws.send(JSON.stringify({ type: 'getSamples' }));
      ws.send(JSON.stringify({ type: 'getBanks' }));
    });
    
    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'samples' && Array.isArray(msg.samples)) {
          dynamicSamples = msg.samples;
          connection.console.log(`Loaded ${dynamicSamples.length} samples from engine`);
        }
        if (msg.type === 'banks' && Array.isArray(msg.banks)) {
          dynamicBanks = msg.banks;
          connection.console.log(`Loaded ${dynamicBanks.length} banks from engine`);
        }
      } catch (e) {
        // Ignore parse errors
      }
    });
    
    ws.on('error', () => {
      connection.console.log('Could not connect to Strudel engine, using default samples');
    });
    
    // Close after getting data
    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }, 5000);
  } catch (e) {
    connection.console.log('WebSocket not available, using default samples');
  }
}

/**
 * Find if position is inside a mini-notation string (inside quotes)
 */
function findMiniNotationContext(document: TextDocument, position: Position): { inMini: boolean; content: string; startOffset: number } | null {
  const text = document.getText();
  const offset = document.offsetAt(position);
  
  // Look backwards for opening quote
  let quoteStart = -1;
  let quoteChar = '';
  for (let i = offset - 1; i >= 0; i--) {
    const char = text[i];
    if (char === '"' || char === "'") {
      // Check if escaped
      if (i > 0 && text[i - 1] === '\\') continue;
      quoteStart = i;
      quoteChar = char;
      break;
    }
    // Stop at newline or semicolon (likely not in same string)
    if (char === '\n' || char === ';') break;
  }
  
  if (quoteStart === -1) return null;
  
  // Look forward for closing quote
  let quoteEnd = -1;
  for (let i = offset; i < text.length; i++) {
    const char = text[i];
    if (char === quoteChar) {
      // Check if escaped
      if (i > 0 && text[i - 1] === '\\') continue;
      quoteEnd = i;
      break;
    }
    if (char === '\n') break;
  }
  
  if (quoteEnd === -1) return null;
  
  const content = text.slice(quoteStart + 1, quoteEnd);
  return { inMini: true, content, startOffset: quoteStart + 1 };
}

/**
 * Get current word at position
 */
function getCurrentWord(text: string, offset: number): string {
  let start = offset;
  let end = offset;
  
  // Go backwards to find word start
  while (start > 0 && /[a-zA-Z0-9_]/.test(text[start - 1])) {
    start--;
  }
  
  // Go forward to find word end
  while (end < text.length && /[a-zA-Z0-9_]/.test(text[end])) {
    end++;
  }
  
  return text.slice(start, end);
}

/**
 * Find function call context at position
 */
function findFunctionContext(text: string, offset: number): { name: string; paramIndex: number } | null {
  let depth = 0;
  let paramIndex = 0;
  
  // Go backwards to find function name
  for (let i = offset - 1; i >= 0; i--) {
    const char = text[i];
    
    if (char === ')') {
      depth++;
    } else if (char === '(') {
      if (depth === 0) {
        // Found opening paren, now find function name
        let nameEnd = i;
        let nameStart = i - 1;
        while (nameStart >= 0 && /[a-zA-Z0-9_]/.test(text[nameStart])) {
          nameStart--;
        }
        nameStart++;
        
        if (nameStart < nameEnd) {
          const name = text.slice(nameStart, nameEnd);
          return { name, paramIndex };
        }
        return null;
      }
      depth--;
    } else if (char === ',' && depth === 0) {
      paramIndex++;
    } else if (char === '\n' || char === ';') {
      break;
    }
  }
  
  return null;
}

connection.onCompletion((params): CompletionItem[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  
  const text = document.getText();
  const offset = document.offsetAt(params.position);
  
  // Check if we're inside a mini-notation string
  const miniContext = findMiniNotationContext(document, params.position);
  
  const items: CompletionItem[] = [];
  
  if (miniContext?.inMini) {
    // Inside mini-notation - suggest samples and notes
    const localOffset = offset - miniContext.startOffset;
    const beforeCursor = miniContext.content.slice(0, localOffset);
    
    // Check if after a colon (sample index)
    if (beforeCursor.endsWith(':')) {
      // Suggest sample indices
      for (let i = 0; i < 16; i++) {
        items.push({
          label: String(i),
          kind: CompletionItemKind.Value,
          detail: `Sample variant ${i}`,
          sortText: String(i).padStart(2, '0'),
        });
      }
      return items;
    }
    
    // Suggest samples
    const samples = getAllSamples();
    for (const sample of samples) {
      items.push({
        label: sample,
        kind: CompletionItemKind.Value,
        detail: 'Sample',
        documentation: `Play ${sample} sound`,
      });
    }
    
    // Suggest notes with octaves
    for (const note of NOTE_NAMES) {
      for (const octave of OCTAVES) {
        items.push({
          label: `${note}${octave}`,
          kind: CompletionItemKind.Value,
          detail: 'Note',
          documentation: `Note ${note.toUpperCase()}${octave}`,
          sortText: `1${note}${octave}`, // Sort notes after samples
        });
      }
    }
    
    // Suggest mini-notation operators
    for (const op of MINI_OPERATORS) {
      items.push({
        label: op.label,
        kind: CompletionItemKind.Operator,
        detail: op.detail,
        documentation: op.documentation,
        sortText: `2${op.label}`, // Sort operators last
      });
    }
  } else {
    // Outside mini-notation - suggest Strudel functions
    
    // Check if we're after a dot (method call)
    const beforeCursor = text.slice(Math.max(0, offset - 50), offset);
    const afterDot = beforeCursor.match(/\.\s*([a-zA-Z]*)$/);
    
    for (const func of STRUDEL_FUNCTIONS) {
      items.push({
        label: func.name,
        kind: CompletionItemKind.Function,
        detail: func.detail,
        documentation: {
          kind: MarkupKind.Markdown,
          value: `${func.documentation}\n\n\`\`\`javascript\n${func.signatures[0].label}\n\`\`\``,
        },
        insertText: afterDot ? `${func.name}($1)` : `${func.name}($1)`,
        insertTextFormat: 2, // Snippet
      });
    }
    
    // Suggest scales
    for (const scale of SCALE_NAMES) {
      items.push({
        label: scale,
        kind: CompletionItemKind.Enum,
        detail: 'Scale',
        documentation: `${scale} scale`,
      });
    }
    
    // Suggest banks if typing .bank(
    if (beforeCursor.includes('.bank(')) {
      const banks = dynamicBanks.length > 0 ? dynamicBanks : ['RolandTR808', 'RolandTR909', 'RolandTR707'];
      for (const bank of banks) {
        items.push({
          label: bank,
          kind: CompletionItemKind.Module,
          detail: 'Sample bank',
          documentation: `Use ${bank} drum machine samples`,
        });
      }
    }
  }
  
  return items;
});

connection.onCompletionResolve((item): CompletionItem => {
  // Add more detail on resolve if needed
  return item;
});

connection.onSignatureHelp((params): SignatureHelp | null => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  
  const text = document.getText();
  const offset = document.offsetAt(params.position);
  
  // Find function context
  const funcContext = findFunctionContext(text, offset);
  if (!funcContext) return null;
  
  // Find matching function
  const func = STRUDEL_FUNCTIONS.find(f => f.name === funcContext.name);
  if (!func) return null;
  
  // Build signature help
  const signatures: SignatureInformation[] = func.signatures.map(sig => {
    const params: ParameterInformation[] = sig.parameters.map(p => ({
      label: p.label,
      documentation: {
        kind: MarkupKind.Markdown,
        value: p.documentation,
      },
    }));
    
    return {
      label: sig.label,
      documentation: sig.documentation || func.documentation,
      parameters: params,
    };
  });
  
  // Select best signature based on parameter count
  let activeSignature = 0;
  for (let i = 0; i < func.signatures.length; i++) {
    if (func.signatures[i].parameters.length > funcContext.paramIndex) {
      activeSignature = i;
      break;
    }
  }
  
  return {
    signatures,
    activeSignature,
    activeParameter: Math.min(funcContext.paramIndex, func.signatures[activeSignature]?.parameters.length - 1 || 0),
  };
});

connection.onHover((params): Hover | null => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  
  const text = document.getText();
  const offset = document.offsetAt(params.position);
  const word = getCurrentWord(text, offset);
  
  if (!word) return null;
  
  const samples = getAllSamples();
  
  // Check samples
  if (samples.includes(word)) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `**${word}** - Sample\n\nPlay the ${word} sound.\n\n\`\`\`javascript\ns("${word}")\n\`\`\``,
      },
    };
  }
  
  // Check notes (strip octave)
  const noteBase = word.replace(/[0-9]/g, '');
  if (NOTE_NAMES.includes(noteBase)) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `**${word}** - Note\n\nMusical note ${noteBase.toUpperCase()}${word.replace(/[^0-9]/g, '')}.\n\n\`\`\`javascript\nnote("${word}")\n\`\`\``,
      },
    };
  }
  
  // Check functions
  const func = STRUDEL_FUNCTIONS.find(f => f.name === word);
  if (func) {
    const sigExamples = func.signatures.map(s => s.label).join('\n');
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `**${func.name}** - ${func.detail}\n\n${func.documentation}\n\n\`\`\`javascript\n${sigExamples}\n\`\`\``,
      },
    };
  }
  
  // Check scales
  if (SCALE_NAMES.includes(word)) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `**${word}** - Scale\n\nMusical scale.\n\n\`\`\`javascript\n.scale("${word}")\n\`\`\``,
      },
    };
  }
  
  // Check mini operators
  const op = MINI_OPERATORS.find(o => o.label === word || o.label.includes(word));
  if (op) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `**${op.label}** - ${op.detail}\n\n${op.documentation}`,
      },
    };
  }
  
  // Check banks
  if (dynamicBanks.includes(word)) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `**${word}** - Sample Bank\n\nDrum machine sample bank.\n\n\`\`\`javascript\n.bank("${word}")\n\`\`\``,
      },
    };
  }
  
  return null;
});

/**
 * Validate document and produce diagnostics
 */
async function validateDocument(document: TextDocument): Promise<void> {
  const text = document.getText();
  const diagnostics: Diagnostic[] = [];
  const docData = new Map<string, DiagnosticData>();
  
  const samples = getAllSamples();
  const functionNames = STRUDEL_FUNCTIONS.map(f => f.name);
  
  // Find all quoted strings and validate mini-notation
  const stringRegex = /(['"])((?:\\.|(?!\1)[^\\])*)\1/g;
  let match;
  
  while ((match = stringRegex.exec(text)) !== null) {
    const content = match[2];
    const startOffset = match.index + 1; // Skip opening quote
    
    // Skip empty strings
    if (!content.trim()) continue;
    
    // Skip strings that look like paths or URLs
    if (content.includes('/') && (content.startsWith('http') || content.startsWith('.') || content.startsWith('github:'))) continue;
    
    // Check for unbalanced brackets
    const brackets: Record<string, string> = { '[': ']', '{': '}', '(': ')', '<': '>' };
    const stack: { char: string; pos: number }[] = [];
    
    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      if (Object.keys(brackets).includes(char)) {
        stack.push({ char, pos: i });
      } else if (Object.values(brackets).includes(char)) {
        const expected = stack.pop();
        if (!expected || brackets[expected.char] !== char) {
          const pos = document.positionAt(startOffset + i);
          const range = Range.create(pos, Position.create(pos.line, pos.character + 1));
          const key = `${range.start.line}:${range.start.character}`;
          
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range,
            message: expected 
              ? `Mismatched bracket: expected '${brackets[expected.char]}' but found '${char}'`
              : `Unexpected closing bracket '${char}'`,
            source: 'strudel',
            code: 'unbalanced-bracket',
          });
          
          docData.set(key, { type: 'unbalanced_bracket' });
        }
      }
    }
    
    // Report unclosed brackets
    for (const unclosed of stack) {
      const pos = document.positionAt(startOffset + unclosed.pos);
      const range = Range.create(pos, Position.create(pos.line, pos.character + 1));
      
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range,
        message: `Unclosed bracket '${unclosed.char}'`,
        source: 'strudel',
        code: 'unclosed-bracket',
      });
    }
    
    // Check for unknown samples
    const words = content.split(/[\s\[\]\{\}\(\)<>:*\/!?@~,|]+/).filter(w => w && !/^[0-9.-]+$/.test(w));
    for (const word of words) {
      // Skip if it looks like a note
      if (/^[a-g][sb]?[0-9]?$/i.test(word)) continue;
      // Skip if it's a known sample
      if (samples.some(s => s.toLowerCase() === word.toLowerCase())) continue;
      // Skip common words/operators
      if (['x', 't', 'f', 'r', '-', '_'].includes(word.toLowerCase())) continue;
      // Skip if it looks like a variable reference
      if (/^[A-Z]/.test(word)) continue;
      
      // Find position of this word in content
      const wordIndex = content.indexOf(word);
      if (wordIndex !== -1) {
        const pos = document.positionAt(startOffset + wordIndex);
        const range = Range.create(pos, Position.create(pos.line, pos.character + word.length));
        const key = `${range.start.line}:${range.start.character}`;
        
        // Find similar samples for suggestion
        const suggestions = findSimilar(word, samples);
        
        const diagnostic: Diagnostic = {
          severity: suggestions.length > 0 ? DiagnosticSeverity.Warning : DiagnosticSeverity.Hint,
          range,
          message: suggestions.length > 0
            ? `Unknown sample '${word}'. Did you mean: ${suggestions.join(', ')}?`
            : `Unknown sample '${word}' (may work if loaded dynamically)`,
          source: 'strudel',
          code: 'unknown-sample',
        };
        
        diagnostics.push(diagnostic);
        docData.set(key, { type: 'unknown_sample', word, suggestions });
      }
    }
  }
  
  // Check function calls outside strings
  const funcCallRegex = /\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
  while ((match = funcCallRegex.exec(text)) !== null) {
    const funcName = match[1];
    const funcStart = match.index + 1; // After the dot
    
    // Skip if known function
    if (functionNames.includes(funcName)) continue;
    // Skip common method names
    if (['then', 'catch', 'map', 'filter', 'forEach', 'reduce', 'log', 'error', 'warn'].includes(funcName)) continue;
    
    const suggestions = findSimilar(funcName, functionNames);
    
    if (suggestions.length > 0) {
      const pos = document.positionAt(funcStart);
      const range = Range.create(pos, Position.create(pos.line, pos.character + funcName.length));
      const key = `${range.start.line}:${range.start.character}`;
      
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range,
        message: `Unknown function '${funcName}'. Did you mean: ${suggestions.join(', ')}?`,
        source: 'strudel',
        code: 'unknown-function',
      });
      
      docData.set(key, { type: 'unknown_function', word: funcName, suggestions });
    }
  }
  
  diagnosticDataMap.set(document.uri, docData);
  connection.sendDiagnostics({ uri: document.uri, diagnostics });
}

connection.onCodeAction((params: CodeActionParams): CodeAction[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  
  const actions: CodeAction[] = [];
  const docData = diagnosticDataMap.get(document.uri);
  
  for (const diagnostic of params.context.diagnostics) {
    if (diagnostic.source !== 'strudel') continue;
    
    const key = `${diagnostic.range.start.line}:${diagnostic.range.start.character}`;
    const data = docData?.get(key);
    
    if (data?.suggestions && data.suggestions.length > 0) {
      for (const suggestion of data.suggestions) {
        actions.push({
          title: `Replace with '${suggestion}'`,
          kind: CodeActionKind.QuickFix,
          diagnostics: [diagnostic],
          isPreferred: data.suggestions.indexOf(suggestion) === 0,
          edit: {
            changes: {
              [params.textDocument.uri]: [
                TextEdit.replace(diagnostic.range, suggestion),
              ],
            },
          },
        });
      }
    }
  }
  
  return actions;
});

// Validate on open and change
documents.onDidOpen((event) => {
  validateDocument(event.document);
});

documents.onDidChangeContent((event) => {
  validateDocument(event.document);
});

documents.onDidClose((event) => {
  diagnosticDataMap.delete(event.document.uri);
});

// Make the text document manager listen on the connection
documents.listen(connection);

// Listen on the connection
connection.listen();

console.error('[strudel-lsp] Server started');
