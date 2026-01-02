#!/usr/bin/env node
/**
 * Compare two WAV files rendered from the same Strudel pattern
 * 
 * Performs detailed waveform analysis including:
 * - Peak alignment (finds the first transient in each file)
 * - Amplitude normalization for fair comparison
 * - Cross-correlation to measure similarity
 * - Envelope extraction and comparison
 * 
 * Usage:
 *   node compare-renders.mjs <file1.wav> <file2.wav> [--normalize] [--align]
 */
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const args = process.argv.slice(2);
const flags = {
  normalize: args.includes('--normalize'),
  align: args.includes('--align'),
  verbose: args.includes('--verbose') || args.includes('-v'),
  help: args.includes('--help') || args.includes('-h'),
};

const files = args.filter(a => !a.startsWith('-'));

if (flags.help || files.length < 2) {
  console.log(`Usage: node compare-renders.mjs [options] <file1.wav> <file2.wav>

Compare two WAV files with detailed waveform analysis.

Options:
  --normalize   Normalize both files to same peak amplitude before comparison
  --align       Align waveforms by finding first transient
  --verbose     Show detailed analysis output and save difference file
  --help        Show this help message

The tool will:
1. Load both WAV files and convert to raw float samples
2. Optionally align by first transient detection
3. Optionally normalize to same peak amplitude
4. Calculate cross-correlation coefficient
5. Extract and compare amplitude envelopes
6. Report timing, amplitude, and shape differences
`);
  process.exit(0);
}

const [file1, file2] = files;

if (!existsSync(file1)) {
  console.error(`File not found: ${file1}`);
  process.exit(1);
}
if (!existsSync(file2)) {
  console.error(`File not found: ${file2}`);
  process.exit(1);
}

console.log('=== WAV Comparison Tool ===\n');
console.log(`File 1: ${file1}`);
console.log(`File 2: ${file2}`);
console.log(`Options: ${flags.normalize ? 'normalize ' : ''}${flags.align ? 'align ' : ''}${flags.verbose ? 'verbose' : ''}`);
console.log('');

// Convert WAV to raw float samples using ffmpeg
function wavToFloat32(file) {
  const tmpFile = `/tmp/compare_${Date.now()}_${Math.random().toString(36).slice(2)}.raw`;
  try {
    // Convert to mono, 48kHz, 32-bit float, raw PCM
    execSync(`ffmpeg -y -i "${file}" -ar 48000 -ac 1 -f f32le -acodec pcm_f32le ${tmpFile} 2>/dev/null`);
    const buffer = readFileSync(tmpFile);
    execSync(`rm -f ${tmpFile}`);
    
    // Convert buffer to Float32Array
    const samples = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
    return samples;
  } catch (e) {
    console.error(`Error converting ${file}: ${e.message}`);
    return null;
  }
}

// Find first transient (first sample above threshold)
function findFirstTransient(samples, threshold = 0.01) {
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) > threshold) {
      return i;
    }
  }
  return 0;
}

// Calculate peak amplitude
function getPeak(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
  }
  return peak;
}

// Calculate RMS amplitude
function getRms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

// Normalize samples to peak of 1.0
function normalize(samples) {
  const peak = getPeak(samples);
  if (peak === 0) return samples;
  const normalized = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    normalized[i] = samples[i] / peak;
  }
  return normalized;
}

// Calculate cross-correlation coefficient (Pearson)
function correlate(samples1, samples2) {
  const len = Math.min(samples1.length, samples2.length);
  
  // Calculate means
  let mean1 = 0, mean2 = 0;
  for (let i = 0; i < len; i++) {
    mean1 += samples1[i];
    mean2 += samples2[i];
  }
  mean1 /= len;
  mean2 /= len;
  
  // Calculate correlation
  let num = 0, den1 = 0, den2 = 0;
  for (let i = 0; i < len; i++) {
    const d1 = samples1[i] - mean1;
    const d2 = samples2[i] - mean2;
    num += d1 * d2;
    den1 += d1 * d1;
    den2 += d2 * d2;
  }
  
  const den = Math.sqrt(den1 * den2);
  return den === 0 ? 0 : num / den;
}

// Extract amplitude envelope using peak detection with window
function extractEnvelope(samples, windowMs = 10, sampleRate = 48000) {
  const windowSize = Math.floor(windowMs * sampleRate / 1000);
  const numWindows = Math.floor(samples.length / windowSize);
  const envelope = new Float32Array(numWindows);
  
  for (let i = 0; i < numWindows; i++) {
    let peak = 0;
    const start = i * windowSize;
    const end = Math.min(start + windowSize, samples.length);
    for (let j = start; j < end; j++) {
      const abs = Math.abs(samples[j]);
      if (abs > peak) peak = abs;
    }
    envelope[i] = peak;
  }
  
  return envelope;
}

// Calculate envelope difference metrics
function compareEnvelopes(env1, env2) {
  const len = Math.min(env1.length, env2.length);
  
  let sumDiff = 0;
  let maxDiff = 0;
  let sumSquaredDiff = 0;
  
  for (let i = 0; i < len; i++) {
    const diff = Math.abs(env1[i] - env2[i]);
    sumDiff += diff;
    if (diff > maxDiff) maxDiff = diff;
    sumSquaredDiff += diff * diff;
  }
  
  return {
    meanDiff: sumDiff / len,
    maxDiff,
    rmsDiff: Math.sqrt(sumSquaredDiff / len),
    correlation: correlate(env1, env2),
  };
}

// Find lag with maximum correlation (for alignment verification)
function findBestLag(samples1, samples2, maxLagMs = 100, sampleRate = 48000) {
  const maxLag = Math.floor(maxLagMs * sampleRate / 1000);
  const len = Math.min(samples1.length, samples2.length) - maxLag;
  
  let bestLag = 0;
  let bestCorr = -Infinity;
  
  // Test negative and positive lags
  for (let lag = -maxLag; lag <= maxLag; lag += Math.floor(sampleRate / 1000)) { // 1ms steps
    let corr = 0;
    let n = 0;
    
    for (let i = 0; i < len; i++) {
      const i1 = i;
      const i2 = i + lag;
      if (i2 >= 0 && i2 < samples2.length) {
        corr += samples1[i1] * samples2[i2];
        n++;
      }
    }
    
    if (n > 0) {
      corr /= n;
      if (corr > bestCorr) {
        bestCorr = corr;
        bestLag = lag;
      }
    }
  }
  
  return { lag: bestLag, lagMs: bestLag / sampleRate * 1000 };
}

// Shift samples by lag amount
function shiftSamples(samples, lag) {
  if (lag === 0) return samples;
  
  const shifted = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const srcIdx = i - lag;
    if (srcIdx >= 0 && srcIdx < samples.length) {
      shifted[i] = samples[srcIdx];
    }
  }
  return shifted;
}

// dB conversion
function toDB(linear) {
  return 20 * Math.log10(Math.max(linear, 1e-10));
}

// Main analysis
console.log('Loading audio files...');
let samples1 = wavToFloat32(file1);
let samples2 = wavToFloat32(file2);

if (!samples1 || !samples2) {
  console.error('Failed to load audio files');
  process.exit(1);
}

console.log(`  File 1: ${samples1.length} samples (${(samples1.length / 48000).toFixed(2)}s)`);
console.log(`  File 2: ${samples2.length} samples (${(samples2.length / 48000).toFixed(2)}s)`);
console.log('');

// Original peaks
const peak1 = getPeak(samples1);
const peak2 = getPeak(samples2);
const rms1 = getRms(samples1);
const rms2 = getRms(samples2);

console.log('=== Original Amplitude ===\n');
console.log(`            | File 1         | File 2         | Difference`);
console.log(`------------|----------------|----------------|------------`);
console.log(`Peak        | ${peak1.toFixed(4).padEnd(14)} | ${peak2.toFixed(4).padEnd(14)} | ${(peak2/peak1).toFixed(2)}x (${toDB(peak2/peak1).toFixed(1)} dB)`);
console.log(`Peak (dB)   | ${toDB(peak1).toFixed(1).padEnd(14)} | ${toDB(peak2).toFixed(1).padEnd(14)} | ${(toDB(peak2) - toDB(peak1)).toFixed(1)} dB`);
console.log(`RMS         | ${rms1.toFixed(4).padEnd(14)} | ${rms2.toFixed(4).padEnd(14)} | ${(rms2/rms1).toFixed(2)}x (${toDB(rms2/rms1).toFixed(1)} dB)`);
console.log(`RMS (dB)    | ${toDB(rms1).toFixed(1).padEnd(14)} | ${toDB(rms2).toFixed(1).padEnd(14)} | ${(toDB(rms2) - toDB(rms1)).toFixed(1)} dB`);
console.log('');

// Transient detection
const transient1 = findFirstTransient(samples1);
const transient2 = findFirstTransient(samples2);
console.log('=== Timing Analysis ===\n');
console.log(`First transient (>1% amplitude):`);
console.log(`  File 1: sample ${transient1} (${(transient1 / 48000 * 1000).toFixed(1)} ms)`);
console.log(`  File 2: sample ${transient2} (${(transient2 / 48000 * 1000).toFixed(1)} ms)`);
console.log(`  Offset: ${((transient2 - transient1) / 48000 * 1000).toFixed(1)} ms`);
console.log('');

// Alignment
if (flags.align) {
  console.log('Aligning waveforms by first transient...');
  if (transient1 > transient2) {
    samples1 = shiftSamples(samples1, transient1 - transient2);
  } else {
    samples2 = shiftSamples(samples2, transient2 - transient1);
  }
  console.log('  Aligned.\n');
}

// Best lag analysis
const lagInfo = findBestLag(samples1, samples2);
console.log(`Best correlation lag: ${lagInfo.lagMs.toFixed(1)} ms`);
if (Math.abs(lagInfo.lagMs) > 5 && !flags.align) {
  console.log(`  (Significant timing offset - consider using --align)`);
}
console.log('');

// Normalization
if (flags.normalize) {
  console.log('Normalizing to peak = 1.0...');
  samples1 = normalize(samples1);
  samples2 = normalize(samples2);
  console.log('  Normalized.\n');
}

// Cross-correlation
console.log('=== Waveform Similarity ===\n');
const correlation = correlate(samples1, samples2);
console.log(`Cross-correlation coefficient: ${correlation.toFixed(4)}`);

if (correlation > 0.95) {
  console.log(`  Excellent match (>0.95)`);
} else if (correlation > 0.8) {
  console.log(`  Good match (0.8-0.95)`);
} else if (correlation > 0.5) {
  console.log(`  Moderate match (0.5-0.8) - noticeable differences`);
} else {
  console.log(`  Poor match (<0.5) - significantly different waveforms`);
}
console.log('');

// Envelope analysis
console.log('=== Envelope Analysis ===\n');
const env1 = extractEnvelope(samples1);
const env2 = extractEnvelope(samples2);
const envComparison = compareEnvelopes(env1, env2);

console.log(`Envelope windows: ${env1.length} (10ms each)`);
console.log(`Envelope correlation: ${envComparison.correlation.toFixed(4)}`);
console.log(`Mean envelope difference: ${envComparison.meanDiff.toFixed(4)}`);
console.log(`Max envelope difference: ${envComparison.maxDiff.toFixed(4)}`);
console.log(`RMS envelope difference: ${envComparison.rmsDiff.toFixed(4)}`);
console.log('');

// Difference signal analysis
console.log('=== Difference Signal ===\n');
const len = Math.min(samples1.length, samples2.length);
const diff = new Float32Array(len);
for (let i = 0; i < len; i++) {
  diff[i] = samples1[i] - samples2[i];
}

const diffPeak = getPeak(diff);
const diffRms = getRms(diff);
const signalRms = Math.max(rms1, rms2);

console.log(`Difference peak: ${diffPeak.toFixed(4)} (${toDB(diffPeak).toFixed(1)} dB)`);
console.log(`Difference RMS: ${diffRms.toFixed(4)} (${toDB(diffRms).toFixed(1)} dB)`);
console.log(`Signal-to-difference ratio: ${toDB(signalRms / diffRms).toFixed(1)} dB`);

if (toDB(signalRms / diffRms) > 40) {
  console.log(`  Very small difference (>40 dB below signal)`);
} else if (toDB(signalRms / diffRms) > 20) {
  console.log(`  Small difference (20-40 dB below signal)`);
} else if (toDB(signalRms / diffRms) > 10) {
  console.log(`  Noticeable difference (10-20 dB below signal)`);
} else {
  console.log(`  Large difference (<10 dB below signal)`);
}
console.log('');

// Summary
console.log('=== Summary ===\n');

const issues = [];
if (Math.abs(toDB(peak2) - toDB(peak1)) > 3) {
  issues.push(`Amplitude: ${(toDB(peak2) - toDB(peak1)).toFixed(1)} dB difference`);
}
if (Math.abs(lagInfo.lagMs) > 5) {
  issues.push(`Timing: ${lagInfo.lagMs.toFixed(1)} ms offset`);
}
if (correlation < 0.9) {
  issues.push(`Waveform: ${((1 - correlation) * 100).toFixed(1)}% shape difference`);
}
if (envComparison.correlation < 0.9) {
  issues.push(`Envelope: ${((1 - envComparison.correlation) * 100).toFixed(1)}% envelope difference`);
}

if (issues.length === 0) {
  console.log('Files appear very similar!');
} else {
  console.log('Detected differences:');
  issues.forEach(issue => console.log(`  - ${issue}`));
}
console.log('');

// Suggestions
console.log('Suggestions:');
if (!flags.normalize && Math.abs(toDB(peak2) - toDB(peak1)) > 3) {
  console.log('  - Try --normalize to compare waveform shape independent of amplitude');
}
if (!flags.align && Math.abs(lagInfo.lagMs) > 5) {
  console.log('  - Try --align to compare with timing correction');
}
console.log('');

// Export difference file for listening
if (flags.verbose) {
  const diffFile = '/tmp/difference.raw';
  const diffBuffer = Buffer.from(diff.buffer);
  writeFileSync(diffFile, diffBuffer);
  execSync(`ffmpeg -y -f f32le -ar 48000 -ac 1 -i ${diffFile} /tmp/difference.wav 2>/dev/null`);
  execSync(`rm -f ${diffFile}`);
  console.log('Difference signal saved to: /tmp/difference.wav');
  console.log('  (Listen to hear what\'s different between the files)');
}
