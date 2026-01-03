#!/usr/bin/env node
/**
 * Real-time pattern renderer for nvim-strudel
 * 
 * Records a Strudel pattern to a WAV file by capturing audio in real-time.
 * Unlike render-pattern.mjs which uses OfflineAudioContext (faster-than-realtime),
 * this script records at normal playback speed.
 * 
 * This is needed for patterns that use AudioWorklet-based synths (pulse, supersaw)
 * because AudioWorklet doesn't work with OfflineAudioContext in node-web-audio-api.
 * 
 * Usage:
 *   node render-pattern-realtime.mjs <pattern-file> <output.wav> [duration-seconds]
 *   echo 's("pulse").note("c3")' | node render-pattern-realtime.mjs - output.wav 5
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
    console.log(`Usage: node render-pattern-realtime.mjs <pattern-file> <output.wav> [duration-seconds]

Records a Strudel pattern to a WAV file in real-time.

This script is needed for patterns using AudioWorklet synths (pulse, supersaw)
which don't work with offline rendering.

Examples:
  # Record a pattern file
  node render-pattern-realtime.mjs path/to/pattern.strudel output.wav 10

  # Pipe pattern code directly
  echo 's("pulse").note("c3")' | node render-pattern-realtime.mjs - output.wav 5

Default duration is 4 seconds.

Note: Recording takes as long as the pattern duration (real-time playback).`);
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
  console.error('Usage: node render-pattern-realtime.mjs <pattern-file> <output.wav> [duration-seconds]');
  console.error('       node render-pattern-realtime.mjs --help  # for more info');
  process.exit(1);
}

// Read pattern code BEFORE initializing audio (to fail fast on file errors)
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

// Configure capture mode BEFORE importing audio polyfill
import { configureCaptureMode, initAudioPolyfill, waitForCapture, getCaptureProgress, resetCapture } from './dist/audio-polyfill.js';

// Configure for real-time capture
const sampleRate = 48000;
configureCaptureMode(duration, sampleRate, 2);

// Now initialize the polyfill
initAudioPolyfill();

// Import strudel engine (this will get our capture-mode AudioContext)
const { StrudelEngine } = await import('./dist/strudel-engine.js');

// Import WAV writer functions
const { writeWav, getPeakAmplitude, getRmsAmplitude } = await import('./dist/file-writer.js');

console.log('Creating Strudel engine...');
const engine = new StrudelEngine();

// Wait for engine initialization (samples loading, etc.)
console.log('Waiting for samples to load...');
await new Promise(r => setTimeout(r, 2500));

console.log('Evaluating pattern...');
try {
  await engine.eval(code);
} catch (err) {
  console.error(`Evaluation error: ${err.message}`);
  process.exit(1);
}

console.log(`Recording for ${duration} seconds (real-time)...`);

// Reset capture buffers right before playback to remove any silence 
// captured during initialization
resetCapture();

// Start playback
engine.play();

const startTime = Date.now();

// Wait for recording to complete, showing progress
const audioBuffer = await waitForCapture((progress) => {
  const elapsed = (Date.now() - startTime) / 1000;
  process.stdout.write(`\rRecording: ${elapsed.toFixed(1)}s / ${duration}s (${(progress * 100).toFixed(0)}%)`);
});

console.log('\nRecording complete!');

// Stop playback
engine.stop();

const elapsed = (Date.now() - startTime) / 1000;
console.log(`Captured ${audioBuffer.length} samples in ${elapsed.toFixed(2)}s`);

// Get amplitude stats
const peak = getPeakAmplitude(audioBuffer);
const rms = getRmsAmplitude(audioBuffer);
console.log(`Peak amplitude: ${peak.toFixed(4)} (${(20 * Math.log10(peak || 0.0001)).toFixed(1)} dB)`);
console.log(`RMS amplitude: ${rms.toFixed(4)} (${(20 * Math.log10(rms || 0.0001)).toFixed(1)} dB)`);

// Write WAV file
const outputPath = resolve(outputFile);
writeWav(audioBuffer, outputPath, 16);

console.log(`Done! Output: ${outputPath}`);
process.exit(0);
