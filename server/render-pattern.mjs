#!/usr/bin/env node
/**
 * Offline pattern renderer for nvim-strudel
 * 
 * Renders a Strudel pattern to a WAV file using superdough's WebAudio synthesis.
 * This captures the exact output of superdough for A/B comparison with OSC/SuperDirt.
 * 
 * Usage:
 *   node render-pattern.mjs <pattern-file> <output.wav> [duration-seconds]
 *   echo 'sound("sbd")' | node render-pattern.mjs - output.wav 5
 * 
 * Default duration is 4 seconds.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Parse arguments
const args = process.argv.slice(2);
let patternFile = null;
let outputFile = null;
let duration = 4;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--help' || arg === '-h') {
    console.log(`Usage: node render-pattern.mjs <pattern-file> <output.wav> [duration-seconds]

Renders a Strudel pattern to a WAV file using superdough's WebAudio synthesis.

Examples:
  # Render a pattern file
  node render-pattern.mjs path/to/pattern.strudel output.wav 10

  # Pipe pattern code directly
  echo 'sound("sbd")' | node render-pattern.mjs - output.wav 5

Default duration is 4 seconds.`);
    process.exit(0);
  } else if (!patternFile) {
    patternFile = arg;
  } else if (!outputFile) {
    outputFile = arg;
  } else {
    const parsed = parseFloat(arg);
    if (!isNaN(parsed)) {
      duration = parsed;
    }
  }
}

if (!patternFile || !outputFile) {
  console.error('Usage: node render-pattern.mjs <pattern-file> <output.wav> [duration-seconds]');
  console.error('       node render-pattern.mjs --help  # for more info');
  process.exit(1);
}

// Read pattern code BEFORE configuring audio (to fail fast on file errors)
let code;
if (patternFile === '-') {
  code = readFileSync(0, 'utf-8');
} else {
  const fullPath = resolve(patternFile);
  try {
    code = readFileSync(fullPath, 'utf-8');
    console.log(`Loading pattern from: ${fullPath}`);
  } catch (e) {
    console.error(`Error reading file: ${e.message}`);
    process.exit(1);
  }
}

// Configure offline rendering BEFORE importing audio polyfill
import { configureOfflineRendering, initAudioPolyfill, renderOffline } from './dist/audio-polyfill.js';

// Configure for offline rendering (must be before initAudioPolyfill)
const sampleRate = 48000;
configureOfflineRendering(duration, sampleRate, 2);

// Now initialize the polyfill (this will set up OfflineAudioContext)
initAudioPolyfill();

// Import strudel engine (this will trigger superdough to get our OfflineAudioContext)
const { StrudelEngine } = await import('./dist/strudel-engine.js');

// Import WAV writer functions from file-writer
const { writeWav, getPeakAmplitude, getRmsAmplitude } = await import('./dist/file-writer.js');

// Import superdough for direct scheduling
// NOTE: We skip initAudio() because it calls ctx.resume() which hangs on OfflineAudioContext
const { superdough, getAudioContext } = await import('superdough');

console.log('Creating Strudel engine...');
const engine = new StrudelEngine();

// Wait for engine initialization (samples loading, etc.)
await new Promise(r => setTimeout(r, 2000));

// Get the audio context (should be our OfflineAudioContext)
const ctx = getAudioContext();
console.log(`AudioContext type: ${ctx.constructor.name}`);
console.log(`AudioContext state: ${ctx.state}`);
console.log(`AudioContext sampleRate: ${ctx.sampleRate}`);

// For offline rendering, we need to evaluate the pattern WITHOUT starting the scheduler.
// The engine's eval() autostarts the scheduler which interferes with OfflineAudioContext.
// Instead, we use Strudel's evaluate function directly.
import { evaluate } from '@strudel/core/evaluate.mjs';
import { transpiler } from '@strudel/transpiler';

console.log('Evaluating pattern...');
let pattern;
try {
  const result = await evaluate(code, transpiler);
  pattern = result.pattern;
  if (!pattern) {
    console.error('Evaluation did not produce a pattern');
    process.exit(1);
  }
} catch (err) {
  console.error(`Evaluation error: ${err.message}`);
  process.exit(1);
}
if (!pattern) {
  console.error('No pattern to render');
  process.exit(1);
}

// Calculate cycles based on duration and cps
// Default Strudel cps is 0.5 (1 cycle = 2 seconds)
const cps = 0.5;
const numCycles = duration * cps;

console.log(`Querying pattern for ${numCycles.toFixed(2)} cycles (${duration}s at ${cps} cps)...`);

// Query all haps for the render duration
const haps = pattern.queryArc(0, numCycles, { _cps: cps });
console.log(`Found ${haps.length} haps to schedule`);

// Schedule each hap using superdough
let scheduledCount = 0;
for (const hap of haps) {
  if (hap.hasOnset()) {
    const cyclePos = hap.whole.begin.valueOf();
    const targetTime = cyclePos / cps;  // Convert cycle position to seconds
    const hapDuration = hap.duration / cps;
    
    // Debug: log scheduling times
    const soundName = hap.value?.s || hap.value?.note || '?';
    console.log(`  Scheduling "${soundName}" at cycle ${cyclePos.toFixed(3)} -> time ${targetTime.toFixed(3)}s (dur: ${hapDuration.toFixed(3)}s)`);
    
    try {
      await superdough(hap.value, targetTime, hapDuration, cps);
      scheduledCount++;
    } catch (err) {
      console.warn(`Failed to schedule hap at ${targetTime.toFixed(3)}s:`, err.message);
    }
  }
}

console.log(`Scheduled ${scheduledCount} sounds`);

// Small delay to ensure all scheduling is complete
await new Promise(r => setTimeout(r, 100));

// Render the offline context
console.log('Rendering audio...');
const audioBuffer = await renderOffline();

// Get amplitude stats
const peak = getPeakAmplitude(audioBuffer);
const rms = getRmsAmplitude(audioBuffer);
console.log(`Peak amplitude: ${peak.toFixed(4)} (${(20 * Math.log10(peak)).toFixed(1)} dB)`);
console.log(`RMS amplitude: ${rms.toFixed(4)} (${(20 * Math.log10(rms)).toFixed(1)} dB)`);

// Write WAV file
const outputPath = resolve(outputFile);
writeWav(audioBuffer, outputPath, 16);

console.log(`Done! Output: ${outputPath}`);
process.exit(0);
