/**
 * File Writer Module
 * 
 * Provides unified interface for writing audio output to files from both
 * WebAudio and OSC backends. This enables audio analysis and comparison
 * between the two rendering engines.
 * 
 * OSC Backend (Fully Implemented):
 *   Captures OSC messages and writes them to a binary score file that can be
 *   rendered by SuperCollider's NRT (Non-Realtime) mode using scsynth -N.
 *   The score file can then be rendered to WAV using:
 *     scsynth -N score.osc _ output.wav 44100 WAV int16 -o 2
 * 
 *   This approach captures:
 *   - All /dirt/play messages with their timing
 *   - Sample names, parameters, and effects
 *   - Can be rendered offline (faster than real-time)
 * 
 * WebAudio Backend (Future Enhancement):
 *   Would use OfflineAudioContext to render audio to a buffer, then write as WAV.
 *   This is more complex because superdough manages its own AudioContext and
 *   the REPL scheduler expects real-time clock progression.
 *   
 *   Current workaround: Use real-time playback and record system audio, or
 *   use the OSC backend with scsynth -N for offline rendering.
 * 
 * Usage for audio comparison:
 *   1. Run pattern with --osc-score to capture OSC messages
 *   2. Render OSC score with scsynth -N to get SuperDirt WAV
 *   3. Compare SuperDirt WAV with real-time WebAudio recording
 */

import * as fs from 'fs';
import * as path from 'path';

// OSC message capture for score file generation
interface CapturedOscMessage {
  time: number;  // Time in seconds from start
  address: string;
  args: Array<{ type: string; value: any }>;
}

// Global state for file writing mode
let fileWriteMode: 'none' | 'webaudio' | 'osc' | 'both' = 'none';
let outputFilePath: string | null = null;
let oscScoreFilePath: string | null = null;
let capturedOscMessages: CapturedOscMessage[] = [];
let recordingStartTime: number = 0;
let isRecording = false;

/**
 * Configure file writing mode
 * @param mode 'none' | 'webaudio' | 'osc' | 'both'
 * @param options Configuration options
 */
export function setFileWriteMode(
  mode: 'none' | 'webaudio' | 'osc' | 'both',
  options: {
    webaudioOutputPath?: string;
    oscScorePath?: string;
  } = {}
): void {
  fileWriteMode = mode;
  outputFilePath = options.webaudioOutputPath || null;
  oscScoreFilePath = options.oscScorePath || null;
  
  console.log(`[file-writer] Mode set to: ${mode}`);
  if (outputFilePath) {
    console.log(`[file-writer] WebAudio output: ${outputFilePath}`);
  }
  if (oscScoreFilePath) {
    console.log(`[file-writer] OSC score output: ${oscScoreFilePath}`);
  }
}

/**
 * Get current file write mode
 */
export function getFileWriteMode(): 'none' | 'webaudio' | 'osc' | 'both' {
  return fileWriteMode;
}

/**
 * Check if we should capture OSC messages for file output
 */
export function shouldCaptureOsc(): boolean {
  return (fileWriteMode === 'osc' || fileWriteMode === 'both') && isRecording;
}

/**
 * Check if we should use offline audio context
 */
export function shouldUseOfflineAudio(): boolean {
  return (fileWriteMode === 'webaudio' || fileWriteMode === 'both');
}

/**
 * Start recording - call before pattern evaluation
 */
export function startRecording(): void {
  capturedOscMessages = [];
  recordingStartTime = Date.now() / 1000;
  isRecording = true;
  console.log('[file-writer] Recording started');
}

/**
 * Stop recording and finalize files
 */
export async function stopRecording(): Promise<{
  webaudioFile?: string;
  oscScoreFile?: string;
  oscJsonFile?: string;
}> {
  isRecording = false;
  const result: { webaudioFile?: string; oscScoreFile?: string; oscJsonFile?: string } = {};
  
  // Write OSC score file if we have captured messages
  if ((fileWriteMode === 'osc' || fileWriteMode === 'both') && oscScoreFilePath) {
    if (capturedOscMessages.length > 0) {
      // Write binary OSC score file
      await writeOscScoreFile(oscScoreFilePath, capturedOscMessages);
      result.oscScoreFile = oscScoreFilePath;
      console.log(`[file-writer] OSC score written: ${oscScoreFilePath} (${capturedOscMessages.length} messages)`);
      
      // Also write JSON file for easier analysis
      const jsonPath = oscScoreFilePath.replace(/\.osc$/, '.json');
      await writeOscJsonFile(jsonPath, capturedOscMessages);
      result.oscJsonFile = jsonPath;
      console.log(`[file-writer] OSC JSON written: ${jsonPath}`);
    } else {
      console.log('[file-writer] No OSC messages captured');
    }
  }
  
  capturedOscMessages = [];
  console.log('[file-writer] Recording stopped');
  
  return result;
}

/**
 * Capture an OSC message for later writing to score file
 * Called from osc-output.ts when sending messages
 */
export function captureOscMessage(
  targetTime: number,
  address: string,
  args: Array<{ type: string; value: any }>
): void {
  if (!shouldCaptureOsc()) return;
  
  // Convert target time to relative time from recording start
  // targetTime is in AudioContext seconds, we need seconds from start
  const relativeTime = Math.max(0, targetTime);
  
  capturedOscMessages.push({
    time: relativeTime,
    address,
    args,
  });
}

/**
 * Write OSC messages to a JSON file for easier analysis and debugging
 * The JSON format converts the args array to a more readable key-value object
 */
async function writeOscJsonFile(
  filePath: string,
  messages: CapturedOscMessage[]
): Promise<void> {
  // Sort messages by time
  const sorted = [...messages].sort((a, b) => a.time - b.time);
  
  // Convert to more readable format
  const readableMessages = sorted.map(msg => {
    // Convert args array to key-value object
    // Args are in [key, value, key, value, ...] format
    const params: Record<string, any> = {};
    for (let i = 0; i < msg.args.length; i += 2) {
      const keyArg = msg.args[i];
      const valueArg = msg.args[i + 1];
      if (keyArg && valueArg) {
        params[keyArg.value] = valueArg.value;
      }
    }
    
    return {
      time: msg.time,
      address: msg.address,
      params,
    };
  });
  
  const output = {
    format: 'strudel-osc-capture',
    version: 1,
    messageCount: readableMessages.length,
    duration: sorted.length > 0 ? sorted[sorted.length - 1].time : 0,
    messages: readableMessages,
  };
  
  // Ensure directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  await fs.promises.writeFile(filePath, JSON.stringify(output, null, 2));
}

/**
 * Write OSC messages to a binary score file for SuperCollider NRT rendering
 * 
 * The score file format is a sequence of OSC bundles:
 * - Each bundle has a timetag (NTP format: 8 bytes)
 * - Followed by the bundle size (4 bytes)
 * - Followed by the bundle content
 * 
 * For NRT, we use a simpler format that scsynth -N expects:
 * - 4 bytes: bundle size (big-endian int32)
 * - 8 bytes: timetag (NTP format, big-endian)
 * - Bundle contents (OSC messages)
 */
async function writeOscScoreFile(
  filePath: string,
  messages: CapturedOscMessage[]
): Promise<void> {
  // Sort messages by time
  const sorted = [...messages].sort((a, b) => a.time - b.time);
  
  // Create buffer chunks for the file
  const chunks: Buffer[] = [];
  
  for (const msg of sorted) {
    const bundle = createOscBundle(msg.time, msg.address, msg.args);
    
    // Write bundle size (4 bytes, big-endian)
    const sizeBuffer = Buffer.alloc(4);
    sizeBuffer.writeInt32BE(bundle.length, 0);
    chunks.push(sizeBuffer);
    
    // Write bundle content
    chunks.push(bundle);
  }
  
  // Add end marker - a dummy message at the end to ensure full rendering
  const lastTime = sorted.length > 0 ? sorted[sorted.length - 1].time + 1 : 1;
  const endBundle = createOscBundle(lastTime, '/c_set', [
    { type: 'i', value: 0 },
    { type: 'f', value: 0 },
  ]);
  const endSizeBuffer = Buffer.alloc(4);
  endSizeBuffer.writeInt32BE(endBundle.length, 0);
  chunks.push(endSizeBuffer);
  chunks.push(endBundle);
  
  // Ensure directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  // Write to file
  const finalBuffer = Buffer.concat(chunks);
  await fs.promises.writeFile(filePath, finalBuffer);
}

/**
 * Create an OSC bundle with timetag
 */
function createOscBundle(
  time: number,
  address: string,
  args: Array<{ type: string; value: any }>
): Buffer {
  const chunks: Buffer[] = [];
  
  // Bundle header: "#bundle\0"
  chunks.push(Buffer.from('#bundle\0'));
  
  // Timetag: NTP format (seconds since 1900-01-01)
  // For NRT, we just use the relative time in seconds
  const timetag = createNtpTimetag(time);
  chunks.push(timetag);
  
  // Create the OSC message
  const message = createOscMessage(address, args);
  
  // Message size (4 bytes, big-endian)
  const msgSizeBuffer = Buffer.alloc(4);
  msgSizeBuffer.writeInt32BE(message.length, 0);
  chunks.push(msgSizeBuffer);
  
  // Message content
  chunks.push(message);
  
  return Buffer.concat(chunks);
}

/**
 * Create NTP timetag from seconds
 * NTP epoch is 1900-01-01, Unix epoch is 1970-01-01
 * Difference is 2208988800 seconds
 */
function createNtpTimetag(seconds: number): Buffer {
  const buffer = Buffer.alloc(8);
  
  // For NRT synthesis, we use the time directly (no epoch offset needed)
  // The first 4 bytes are seconds, the next 4 are fractional seconds
  const wholeSecs = Math.floor(seconds);
  const fracSecs = Math.floor((seconds - wholeSecs) * 0xFFFFFFFF);
  
  buffer.writeUInt32BE(wholeSecs, 0);
  buffer.writeUInt32BE(fracSecs, 4);
  
  return buffer;
}

/**
 * Create an OSC message
 */
function createOscMessage(
  address: string,
  args: Array<{ type: string; value: any }>
): Buffer {
  const chunks: Buffer[] = [];
  
  // Address (null-terminated, padded to 4-byte boundary)
  chunks.push(createOscString(address));
  
  // Type tag string
  let typeTag = ',';
  for (const arg of args) {
    typeTag += arg.type;
  }
  chunks.push(createOscString(typeTag));
  
  // Arguments
  for (const arg of args) {
    chunks.push(encodeOscArg(arg.type, arg.value));
  }
  
  return Buffer.concat(chunks);
}

/**
 * Create a null-terminated, 4-byte-padded OSC string
 */
function createOscString(str: string): Buffer {
  const strBytes = Buffer.from(str + '\0', 'ascii');
  const paddedLength = Math.ceil(strBytes.length / 4) * 4;
  const buffer = Buffer.alloc(paddedLength);
  strBytes.copy(buffer);
  return buffer;
}

/**
 * Encode an OSC argument
 */
function encodeOscArg(type: string, value: any): Buffer {
  switch (type) {
    case 'i': {
      const buffer = Buffer.alloc(4);
      buffer.writeInt32BE(value, 0);
      return buffer;
    }
    case 'f': {
      const buffer = Buffer.alloc(4);
      buffer.writeFloatBE(value, 0);
      return buffer;
    }
    case 'd': {
      const buffer = Buffer.alloc(8);
      buffer.writeDoubleBE(value, 0);
      return buffer;
    }
    case 's':
    case 'S': {
      return createOscString(String(value));
    }
    case 'T':
    case 'F':
    case 'N':
    case 'I': {
      // These types have no data
      return Buffer.alloc(0);
    }
    default: {
      // Unknown type, try as string
      console.warn(`[file-writer] Unknown OSC type: ${type}, encoding as string`);
      return createOscString(String(value));
    }
  }
}

/**
 * Convert an AudioBuffer to WAV format
 */
export function audioBufferToWav(
  audioBuffer: AudioBuffer,
  options: { bitDepth?: 16 | 24 | 32 } = {}
): Buffer {
  const bitDepth = options.bitDepth || 16;
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  
  // Calculate sizes
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = length * blockAlign;
  const fileSize = 44 + dataSize; // 44 bytes for WAV header
  
  const buffer = Buffer.alloc(fileSize);
  let offset = 0;
  
  // RIFF header
  buffer.write('RIFF', offset); offset += 4;
  buffer.writeUInt32LE(fileSize - 8, offset); offset += 4;
  buffer.write('WAVE', offset); offset += 4;
  
  // fmt chunk
  buffer.write('fmt ', offset); offset += 4;
  buffer.writeUInt32LE(16, offset); offset += 4; // fmt chunk size
  buffer.writeUInt16LE(bitDepth === 32 ? 3 : 1, offset); offset += 2; // format (1=PCM, 3=float)
  buffer.writeUInt16LE(numChannels, offset); offset += 2;
  buffer.writeUInt32LE(sampleRate, offset); offset += 4;
  buffer.writeUInt32LE(sampleRate * blockAlign, offset); offset += 4; // byte rate
  buffer.writeUInt16LE(blockAlign, offset); offset += 2;
  buffer.writeUInt16LE(bitDepth, offset); offset += 2;
  
  // data chunk
  buffer.write('data', offset); offset += 4;
  buffer.writeUInt32LE(dataSize, offset); offset += 4;
  
  // Interleave channel data
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(audioBuffer.getChannelData(c));
  }
  
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = channels[c][i];
      
      if (bitDepth === 16) {
        // Convert float [-1, 1] to int16 [-32768, 32767]
        const intSample = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
        buffer.writeInt16LE(intSample, offset);
        offset += 2;
      } else if (bitDepth === 24) {
        // Convert float [-1, 1] to int24 [-8388608, 8388607]
        const intSample = Math.max(-8388608, Math.min(8388607, Math.round(sample * 8388607)));
        buffer.writeIntLE(intSample, offset, 3);
        offset += 3;
      } else {
        // 32-bit float
        buffer.writeFloatLE(sample, offset);
        offset += 4;
      }
    }
  }
  
  return buffer;
}

/**
 * Write an AudioBuffer to a WAV file
 */
export async function writeWavFile(
  filePath: string,
  audioBuffer: AudioBuffer,
  options: { bitDepth?: 16 | 24 | 32 } = {}
): Promise<void> {
  const wavBuffer = audioBufferToWav(audioBuffer, options);
  
  // Ensure directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  await fs.promises.writeFile(filePath, wavBuffer);
  console.log(`[file-writer] WAV file written: ${filePath}`);
}

/**
 * Synchronous WAV write for simpler usage
 */
export function writeWav(
  audioBuffer: AudioBuffer,
  filePath: string,
  bitDepth: 16 | 24 | 32 = 16
): void {
  const wavBuffer = audioBufferToWav(audioBuffer, { bitDepth });
  
  // Ensure directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(filePath, wavBuffer);
  console.log(`[file-writer] WAV file written: ${filePath} (${audioBuffer.numberOfChannels}ch, ${audioBuffer.sampleRate}Hz, ${bitDepth}bit, ${audioBuffer.duration.toFixed(2)}s)`);
}

/**
 * Calculate peak amplitude of an AudioBuffer
 */
export function getPeakAmplitude(buffer: AudioBuffer): number {
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      peak = Math.max(peak, Math.abs(data[i]));
    }
  }
  return peak;
}

/**
 * Calculate RMS amplitude of an AudioBuffer
 */
export function getRmsAmplitude(buffer: AudioBuffer): number {
  let sumSquares = 0;
  let totalSamples = 0;
  
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      sumSquares += data[i] * data[i];
      totalSamples++;
    }
  }
  
  return Math.sqrt(sumSquares / totalSamples);
}

/**
 * Get the configured output paths
 */
export function getOutputPaths(): {
  webaudioPath: string | null;
  oscScorePath: string | null;
} {
  return {
    webaudioPath: outputFilePath,
    oscScorePath: oscScoreFilePath,
  };
}

/**
 * Render pattern using SuperCollider NRT mode
 * This is a helper that calls scsynth -N after the score file is written
 * 
 * @param scorePath Path to the binary OSC score file
 * @param outputPath Path for the output WAV file
 * @param options Rendering options
 */
export async function renderOscScoreToWav(
  scorePath: string,
  outputPath: string,
  options: {
    sampleRate?: number;
    headerFormat?: string;
    sampleFormat?: string;
    numChannels?: number;
    scynthPath?: string;
  } = {}
): Promise<void> {
  const {
    sampleRate = 44100,
    headerFormat = 'WAV',
    sampleFormat = 'int16',
    numChannels = 2,
    scynthPath = 'scsynth',
  } = options;
  
  const { spawn } = await import('child_process');
  
  return new Promise((resolve, reject) => {
    // scsynth -N <score.osc> _ <output.wav> <sampleRate> <headerFormat> <sampleFormat> -o <numChannels>
    const args = [
      '-N',
      scorePath,
      '_', // No input file
      outputPath,
      String(sampleRate),
      headerFormat,
      sampleFormat,
      '-o', String(numChannels),
    ];
    
    console.log(`[file-writer] Running: ${scynthPath} ${args.join(' ')}`);
    
    const proc = spawn(scynthPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`[file-writer] NRT render complete: ${outputPath}`);
        resolve();
      } else {
        reject(new Error(`scsynth exited with code ${code}: ${stderr || stdout}`));
      }
    });
    
    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn scsynth: ${err.message}`));
    });
  });
}
