#!/usr/bin/env node
/**
 * Quick MIDI test script - verify port selection
 */
import { execSync } from 'child_process';

// Kill any existing strudel-server processes
try {
  execSync('pkill -f "node.*strudel-server\\|node.*dist/index.js" 2>/dev/null || true', { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 500));
} catch (e) {}

// Initialize audio polyfill BEFORE importing engine
import { initAudioPolyfill } from './dist/audio-polyfill.js';
initAudioPolyfill();

const { StrudelEngine } = await import('./dist/strudel-engine.js');

console.log('Creating Strudel engine...');
const engine = new StrudelEngine();

// Disable WebAudio to avoid noise - MIDI only
engine.setWebAudioEnabled(false);

// Wait for engine initialization
await new Promise(r => setTimeout(r, 2000));

// Test: verify we can target FLUID Synth specifically
// The note pattern should play through FLUID Synth only
console.log('\n=== MIDI Port Selection Test ===');
console.log('This should play through FLUID Synth, NOT Midi Through');
console.log('Listen for piano sounds (FLUID Synth) vs silence (if going to Midi Through)\n');

// Use single quotes inside the Strudel code for the port name
const code = `note("c4 e4 g4 c5").midi('FLUID Synth')`;
console.log(`Code: ${code}`);

const result = await engine.eval(code);
if (!result.success) {
  console.error(`Error: ${result.error}`);
  engine.dispose();
  process.exit(1);
}

console.log('Playing for 4 seconds...');
engine.play();
await new Promise(r => setTimeout(r, 4000));
engine.stop();

console.log('\nNow testing midiport() method...');
const code2 = `note("e4 g4 b4 e5").midi().midiport('FLUID Synth')`;
console.log(`Code: ${code2}`);

const result2 = await engine.eval(code2);
if (!result2.success) {
  console.error(`Error: ${result2.error}`);
  engine.dispose();
  process.exit(1);
}

console.log('Playing for 4 seconds...');
engine.play();
await new Promise(r => setTimeout(r, 4000));
engine.stop();

console.log('\nTests complete');
engine.dispose();
process.exit(0);
