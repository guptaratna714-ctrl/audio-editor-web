/**
 * AuraWave Audio Studio - High-Performance Web Audio API Engine
 * 100% Client-Side Local Audio Processing & Encoding
 */

import { Mp3Encoder } from 'lamejs';

// Global shared AudioContext (instantiated on user interaction)
let sharedAudioContext: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedAudioContext = new AudioCtx();
  }
  if (sharedAudioContext.state === 'suspended') {
    sharedAudioContext.resume();
  }
  return sharedAudioContext;
}

/**
 * Decodes an uploaded Audio File (File or Blob) into an AudioBuffer
 */
export async function decodeAudioData(blob: Blob | File): Promise<AudioBuffer> {
  const ctx = getAudioContext();
  const arrayBuffer = await blob.arrayBuffer();
  // decodeAudioData consumes arrayBuffer, so slice a copy to be safe
  return await ctx.decodeAudioData(arrayBuffer.slice(0));
}

/**
 * Creates an exact deep clone of an AudioBuffer
 */
export function cloneAudioBuffer(source: AudioBuffer): AudioBuffer {
  const ctx = getAudioContext();
  const clone = ctx.createBuffer(
    source.numberOfChannels,
    source.length,
    source.sampleRate
  );
  for (let ch = 0; ch < source.numberOfChannels; ch++) {
    clone.copyToChannel(source.getChannelData(ch), ch);
  }
  return clone;
}

/**
 * Trims or cuts an AudioBuffer
 * - 'keep': Keeps only the selection between startTime and endTime (crops)
 * - 'cut': Removes the selection and concatenates the surrounding segments
 */
export function sliceAudioBuffer(
  source: AudioBuffer,
  startTime: number,
  endTime: number,
  mode: 'keep' | 'cut' = 'keep',
  fadeInSec = 0.005,
  fadeOutSec = 0.005
): AudioBuffer {
  const ctx = getAudioContext();
  const sampleRate = source.sampleRate;
  const numChannels = source.numberOfChannels;

  const startSample = Math.max(0, Math.floor(startTime * sampleRate));
  const endSample = Math.min(source.length, Math.floor(endTime * sampleRate));

  if (startSample >= endSample && mode === 'keep') {
    throw new Error('Selection range is too small to crop');
  }

  if (mode === 'keep') {
    const newLength = Math.max(1, endSample - startSample);
    const newBuffer = ctx.createBuffer(numChannels, newLength, sampleRate);

    for (let ch = 0; ch < numChannels; ch++) {
      const srcData = source.getChannelData(ch);
      const destData = newBuffer.getChannelData(ch);
      
      for (let i = 0; i < newLength; i++) {
        destData[i] = srcData[startSample + i];
      }

      // Apply subtle fade in/out to prevent boundary clicks
      applyFadeIn(destData, sampleRate, fadeInSec);
      applyFadeOut(destData, sampleRate, fadeOutSec);
    }
    return newBuffer;
  } else {
    // Cut out selection
    const cutLength = endSample - startSample;
    const newLength = Math.max(1, source.length - cutLength);
    const newBuffer = ctx.createBuffer(numChannels, newLength, sampleRate);

    for (let ch = 0; ch < numChannels; ch++) {
      const srcData = source.getChannelData(ch);
      const destData = newBuffer.getChannelData(ch);

      // Copy before cut
      let destIdx = 0;
      for (let i = 0; i < startSample; i++) {
        destData[destIdx++] = srcData[i];
      }
      // Copy after cut
      for (let i = endSample; i < source.length; i++) {
        destData[destIdx++] = srcData[i];
      }

      // Smooth splice point
      if (startSample > 0 && startSample < newLength) {
        const smoothSamples = Math.floor(sampleRate * 0.005);
        for (let s = 0; s < smoothSamples; s++) {
          const idx = startSample - smoothSamples + s;
          if (idx >= 0 && idx < newLength) {
            const factor = s / smoothSamples;
            destData[idx] *= factor;
          }
        }
      }
    }
    return newBuffer;
  }
}

/**
 * Changes volume/gain of an AudioBuffer
 * @param gainFactor multiplier (e.g. 1.0 = unchanged, 0.5 = -6dB, 2.0 = +6dB)
 * @param range optional selection range in seconds
 */
export function applyGainToBuffer(
  source: AudioBuffer,
  gainFactor: number,
  range?: { start: number; end: number }
): AudioBuffer {
  const result = cloneAudioBuffer(source);
  const sampleRate = source.sampleRate;
  const startSample = range ? Math.max(0, Math.floor(range.start * sampleRate)) : 0;
  const endSample = range ? Math.min(source.length, Math.floor(range.end * sampleRate)) : source.length;

  for (let ch = 0; ch < result.numberOfChannels; ch++) {
    const data = result.getChannelData(ch);
    for (let i = startSample; i < endSample; i++) {
      data[i] = Math.max(-1, Math.min(1, data[i] * gainFactor));
    }
  }
  return result;
}

/**
 * Normalizes an AudioBuffer to peak dBFS (default -0.1 dBFS)
 */
export function normalizeAudioBuffer(source: AudioBuffer, targetPeakDb = -0.1): AudioBuffer {
  let peak = 0;
  for (let ch = 0; ch < source.numberOfChannels; ch++) {
    const data = source.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
  }

  if (peak === 0) return cloneAudioBuffer(source);

  const targetPeak = Math.pow(10, targetPeakDb / 20);
  const multiplier = targetPeak / peak;

  return applyGainToBuffer(source, multiplier);
}

/**
 * Reverses audio buffer or selected portion
 */
export function reverseAudioBuffer(
  source: AudioBuffer,
  range?: { start: number; end: number }
): AudioBuffer {
  const result = cloneAudioBuffer(source);
  const sampleRate = source.sampleRate;
  const startSample = range ? Math.max(0, Math.floor(range.start * sampleRate)) : 0;
  const endSample = range ? Math.min(source.length, Math.floor(range.end * sampleRate)) : source.length;
  const length = endSample - startSample;

  for (let ch = 0; ch < result.numberOfChannels; ch++) {
    const data = result.getChannelData(ch);
    // Reverse subarray
    for (let i = 0; i < Math.floor(length / 2); i++) {
      const idxA = startSample + i;
      const idxB = endSample - 1 - i;
      const temp = data[idxA];
      data[idxA] = data[idxB];
      data[idxB] = temp;
    }
  }
  return result;
}

export interface EQBand {
  freq: number;
  gain: number; // in dB (-15 to +15)
  q?: number;
  type?: BiquadFilterType;
}

/**
 * Applies multi-band Equalizer using OfflineAudioContext for pristine rendering
 */
export async function applyEqualizerToBuffer(
  source: AudioBuffer,
  bands: EQBand[]
): Promise<AudioBuffer> {
  const offlineCtx = new OfflineAudioContext(
    source.numberOfChannels,
    source.length,
    source.sampleRate
  );

  const sourceNode = offlineCtx.createBufferSource();
  sourceNode.buffer = source;

  let lastNode: AudioNode = sourceNode;

  // Chain biquad filter nodes
  bands.forEach((band) => {
    if (Math.abs(band.gain) < 0.01) return; // Skip zero gain

    const filter = offlineCtx.createBiquadFilter();
    filter.frequency.value = band.freq;
    filter.gain.value = band.gain;
    filter.Q.value = band.q || 1.0;

    if (band.type) {
      filter.type = band.type;
    } else {
      if (band.freq <= 80) filter.type = 'lowshelf';
      else if (band.freq >= 12000) filter.type = 'highshelf';
      else filter.type = 'peaking';
    }

    lastNode.connect(filter);
    lastNode = filter;
  });

  lastNode.connect(offlineCtx.destination);
  sourceNode.start(0);

  return await offlineCtx.startRendering();
}

/**
 * Resamples an AudioBuffer by a factor (changes speed and pitch coupled, classic vinyl)
 */
export async function resampleBuffer(source: AudioBuffer, rateFactor: number): Promise<AudioBuffer> {
  if (Math.abs(rateFactor - 1.0) < 0.001) return cloneAudioBuffer(source);

  const newLength = Math.max(1, Math.round(source.length / rateFactor));
  const offlineCtx = new OfflineAudioContext(
    source.numberOfChannels,
    newLength,
    source.sampleRate
  );

  const sourceNode = offlineCtx.createBufferSource();
  sourceNode.buffer = source;
  sourceNode.playbackRate.value = rateFactor;
  sourceNode.connect(offlineCtx.destination);
  sourceNode.start(0);

  return await offlineCtx.startRendering();
}

/**
 * High Quality Synchronous Overlap-Add (SOLA) algorithm
 * Time-stretches an AudioBuffer to change speed without altering pitch!
 */
export function timeStretchBuffer(source: AudioBuffer, speedFactor: number): AudioBuffer {
  if (Math.abs(speedFactor - 1.0) < 0.001) return cloneAudioBuffer(source);

  const ctx = getAudioContext();
  const sampleRate = source.sampleRate;
  const numChannels = source.numberOfChannels;

  // SOLA parameters tuned for music & speech
  const windowSize = Math.floor(sampleRate * 0.04); // 40ms window
  const hopSize = Math.floor(windowSize / 2); // 50% overlap
  const searchRange = Math.floor(windowSize * 0.4);

  const inLength = source.length;
  const outLength = Math.max(1, Math.floor(inLength / speedFactor));

  const result = ctx.createBuffer(numChannels, outLength, sampleRate);

  // Compute Hanning window
  const window = new Float32Array(windowSize);
  for (let i = 0; i < windowSize; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (windowSize - 1)));
  }

  for (let ch = 0; ch < numChannels; ch++) {
    const input = source.getChannelData(ch);
    const output = result.getChannelData(ch);
    const norm = new Float32Array(outLength);

    let inPos = 0;
    let outPos = 0;

    while (outPos + windowSize < outLength && inPos + windowSize + searchRange < inLength) {
      // Find optimal alignment via cross-correlation if past first frame
      let bestOffset = 0;
      if (outPos > 0) {
        let maxCorr = -Infinity;
        for (let offset = -searchRange; offset <= searchRange; offset++) {
          const testIn = inPos + offset;
          if (testIn < 0 || testIn + windowSize >= inLength) continue;

          let corr = 0;
          for (let k = 0; k < windowSize; k += 4) { // subsample for speed
            corr += input[testIn + k] * output[outPos + k];
          }
          if (corr > maxCorr) {
            maxCorr = corr;
            bestOffset = offset;
          }
        }
      }

      const optimalIn = inPos + bestOffset;

      // Overlap-add
      for (let i = 0; i < windowSize; i++) {
        const outIdx = outPos + i;
        if (outIdx < outLength && optimalIn + i < inLength) {
          const w = window[i];
          output[outIdx] += input[optimalIn + i] * w;
          norm[outIdx] += w;
        }
      }

      inPos = Math.floor(outPos * speedFactor);
      outPos += hopSize;
    }

    // Normalize overlapping window amplitudes
    for (let i = 0; i < outLength; i++) {
      if (norm[i] > 0.001) {
        output[i] /= norm[i];
      }
      output[i] = Math.max(-1, Math.min(1, output[i]));
    }
  }

  return result;
}

/**
 * Pitch-shift an AudioBuffer independently of duration
 * Achieved by resampling (speed+pitch shift) followed by SOLA time-stretch (restoring duration)!
 */
export async function pitchShiftBuffer(
  source: AudioBuffer,
  semitones: number,
  cents = 0
): Promise<AudioBuffer> {
  const totalSemitones = semitones + cents / 100;
  if (Math.abs(totalSemitones) < 0.01) return cloneAudioBuffer(source);

  // Pitch factor: 2^(semitones/12)
  const pitchFactor = Math.pow(2, totalSemitones / 12);

  // Step 1: Resample audio by pitchFactor (alters both pitch and speed)
  const resampled = await resampleBuffer(source, pitchFactor);

  // Step 2: Time-stretch to restore original duration without altering pitch!
  const finalBuffer = timeStretchBuffer(resampled, 1 / pitchFactor);
  return finalBuffer;
}

/**
 * Combined Speed and Pitch Adjustment
 */
export async function changeSpeedAndPitch(
  source: AudioBuffer,
  speedFactor: number,
  semitones: number,
  cents: number,
  preservePitch: boolean
): Promise<AudioBuffer> {
  const totalSemitones = semitones + cents / 100;

  if (!preservePitch) {
    // Vinyl/Tape resample mode
    const effectiveRate = speedFactor * Math.pow(2, totalSemitones / 12);
    return await resampleBuffer(source, effectiveRate);
  }

  // Independent speed + independent pitch
  let buffer = cloneAudioBuffer(source);

  if (Math.abs(speedFactor - 1.0) > 0.005) {
    buffer = timeStretchBuffer(buffer, speedFactor);
  }

  if (Math.abs(totalSemitones) > 0.01) {
    buffer = await pitchShiftBuffer(buffer, semitones, cents);
  }

  return buffer;
}

/**
 * Joins multiple audio buffers with optional crossfade between adjacent tracks
 */
export function joinAudioBuffers(
  tracks: { buffer: AudioBuffer; volume: number }[],
  crossfadeDuration = 0
): AudioBuffer {
  if (tracks.length === 0) throw new Error('No audio tracks to join');
  if (tracks.length === 1) {
    const single = tracks[0];
    return applyGainToBuffer(single.buffer, single.volume);
  }

  const ctx = getAudioContext();
  const sampleRate = tracks[0].buffer.sampleRate;
  const maxChannels = Math.max(...tracks.map(t => t.buffer.numberOfChannels));
  const crossfadeSamples = Math.floor(crossfadeDuration * sampleRate);

  // Calculate total joined sample length
  let totalSamples = 0;
  for (let i = 0; i < tracks.length; i++) {
    totalSamples += tracks[i].buffer.length;
    if (i > 0 && crossfadeDuration > 0) {
      const maxOverlap = Math.min(
        crossfadeSamples,
        tracks[i - 1].buffer.length / 2,
        tracks[i].buffer.length / 2
      );
      totalSamples -= Math.floor(maxOverlap);
    }
  }

  const result = ctx.createBuffer(maxChannels, Math.max(1, totalSamples), sampleRate);

  let currentOffset = 0;

  for (let t = 0; t < tracks.length; t++) {
    const track = tracks[t];
    const srcBuf = track.buffer;
    const vol = track.volume;
    const trackLen = srcBuf.length;

    let overlap = 0;
    if (t > 0 && crossfadeDuration > 0) {
      overlap = Math.floor(
        Math.min(crossfadeSamples, tracks[t - 1].buffer.length / 2, trackLen / 2)
      );
    }

    const startPos = currentOffset - overlap;

    for (let ch = 0; ch < maxChannels; ch++) {
      const destData = result.getChannelData(ch);
      const srcCh = ch < srcBuf.numberOfChannels ? ch : 0;
      const srcData = srcBuf.getChannelData(srcCh);

      for (let i = 0; i < trackLen; i++) {
        const destIdx = startPos + i;
        if (destIdx >= 0 && destIdx < totalSamples) {
          let factor = vol;

          // Crossfade overlap calculations
          if (overlap > 0 && i < overlap) {
            // Fade in current track
            factor *= (i / overlap);
          } else if (t < tracks.length - 1 && crossfadeDuration > 0) {
            const nextOverlap = Math.floor(
              Math.min(crossfadeSamples, trackLen / 2, tracks[t + 1].buffer.length / 2)
            );
            if (i >= trackLen - nextOverlap) {
              // Fade out current track
              const fadePos = i - (trackLen - nextOverlap);
              factor *= (1 - fadePos / nextOverlap);
            }
          }

          destData[destIdx] += srcData[i] * factor;
          // Soft clip
          if (destData[destIdx] > 1) destData[destIdx] = 1;
          if (destData[destIdx] < -1) destData[destIdx] = -1;
        }
      }
    }

    currentOffset = startPos + trackLen;
  }

  return result;
}

// Helper: Apply fade in
function applyFadeIn(data: Float32Array, sampleRate: number, durationSec: number) {
  const fadeSamples = Math.min(data.length, Math.floor(sampleRate * durationSec));
  for (let i = 0; i < fadeSamples; i++) {
    data[i] *= (i / fadeSamples);
  }
}

// Helper: Apply fade out
function applyFadeOut(data: Float32Array, sampleRate: number, durationSec: number) {
  const fadeSamples = Math.min(data.length, Math.floor(sampleRate * durationSec));
  const start = data.length - fadeSamples;
  for (let i = 0; i < fadeSamples; i++) {
    data[start + i] *= (1 - i / fadeSamples);
  }
}

/**
 * 16-bit PCM WAV Encoder (Instant, zero loss, 100% offline)
 */
export function audioBufferToWav(buffer: AudioBuffer, opt: { bitDepth?: 16 | 32 } = {}): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bitDepth = opt.bitDepth || 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const numSamples = buffer.length;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;

  const bufferSize = 44 + dataSize;
  const arrayBuffer = new ArrayBuffer(bufferSize);
  const view = new DataView(arrayBuffer);

  // Write RIFF Header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // SubChunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Interleave and write audio samples
  let offset = 44;
  if (bitDepth === 16) {
    for (let i = 0; i < numSamples; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
        const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset, intSample, true);
        offset += 2;
      }
    }
  } else {
    // 32-bit float
    for (let i = 0; i < numSamples; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = buffer.getChannelData(ch)[i];
        view.setFloat32(offset, sample, true);
        offset += 4;
      }
    }
  }

  return new Blob([view], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * MP3 Encoder using lamejs
 */
export async function audioBufferToMp3(
  buffer: AudioBuffer,
  kbps = 192,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const encoder = new Mp3Encoder(numChannels, sampleRate, kbps);
  const mp3Data: Int8Array[] = [];

  const leftChannel = buffer.getChannelData(0);
  const rightChannel = numChannels > 1 ? buffer.getChannelData(1) : leftChannel;

  // Convert float32 [-1, 1] to Int16Array [-32768, 32767]
  const chunkSize = 1152 * 4; // Lame standard frame size
  const totalSamples = buffer.length;

  for (let i = 0; i < totalSamples; i += chunkSize) {
    const currentChunk = Math.min(chunkSize, totalSamples - i);
    const leftInt16 = new Int16Array(currentChunk);
    const rightInt16 = new Int16Array(currentChunk);

    for (let j = 0; j < currentChunk; j++) {
      const idx = i + j;
      const l = Math.max(-1, Math.min(1, leftChannel[idx]));
      leftInt16[j] = l < 0 ? l * 0x8000 : l * 0x7FFF;

      if (numChannels > 1) {
        const r = Math.max(-1, Math.min(1, rightChannel[idx]));
        rightInt16[j] = r < 0 ? r * 0x8000 : r * 0x7FFF;
      }
    }

    let mp3buf: Int8Array;
    if (numChannels === 1) {
      mp3buf = encoder.encodeBuffer(leftInt16);
    } else {
      mp3buf = encoder.encodeBuffer(leftInt16, rightInt16);
    }

    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }

    if (onProgress && i % (chunkSize * 4) === 0) {
      onProgress(Math.min(0.95, i / totalSamples));
      // Give UI a chance to render
      await new Promise(r => setTimeout(r, 0));
    }
  }

  const flushBuf = encoder.flush();
  if (flushBuf.length > 0) {
    mp3Data.push(flushBuf);
  }

  if (onProgress) onProgress(1.0);

  return new Blob(mp3Data as unknown as BlobPart[], { type: 'audio/mp3' });
}

/**
 * Encodes AudioBuffer into OGG / WebM Opus Blob
 */
export async function audioBufferToOgg(
  buffer: AudioBuffer,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  // Check supported mime types
  const preferredMimes = [
    'audio/ogg; codecs=opus',
    'audio/ogg',
    'audio/webm; codecs=opus',
    'audio/webm'
  ];

  let selectedMime = preferredMimes.find(m => MediaRecorder.isTypeSupported(m));

  if (!selectedMime) {
    // If MediaRecorder doesn't support ogg/webm opus, fallback to WAV with warning
    console.warn('Browser MediaRecorder does not support Ogg/WebM opus, falling back to WAV');
    return audioBufferToWav(buffer);
  }

  const ctx = getAudioContext();
  const dest = ctx.createMediaStreamDestination();
  const recorder = new MediaRecorder(dest.stream, {
    mimeType: selectedMime,
    audioBitsPerSecond: 192000
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const bufferSource = ctx.createBufferSource();
  bufferSource.buffer = buffer;
  bufferSource.connect(dest);

  const durationMs = buffer.duration * 1000;

  return new Promise((resolve) => {
    recorder.onstop = () => {
      if (onProgress) onProgress(1);
      const outputType = selectedMime?.includes('ogg') ? 'audio/ogg' : 'audio/webm';
      resolve(new Blob(chunks, { type: outputType }));
    };

    recorder.start(100);
    bufferSource.start();

    // Progress updates
    const startT = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startT;
      const progress = Math.min(0.95, elapsed / durationMs);
      if (onProgress) onProgress(progress);
    }, 200);

    setTimeout(() => {
      clearInterval(interval);
      try {
        recorder.stop();
        bufferSource.stop();
      } catch {
        // already stopped
      }
    }, durationMs + 200);
  });
}

/**
 * Generate built-in Demo Audio Track for instant hands-on testing
 * Synthesizes a warm acoustic chords + synth groove with pleasant bassline
 */
export function generateDemoTrack(): AudioBuffer {
  const ctx = getAudioContext();
  const sampleRate = ctx.sampleRate;
  const duration = 8.0; // 8 seconds loop
  const totalSamples = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(2, totalSamples, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  // Musical progression: Cmaj7 - Am7 - Dm7 - G7 (2 sec each)
  const chords = [
    [261.63, 329.63, 392.00, 493.88], // Cmaj7 (C4, E4, G4, B4)
    [220.00, 261.63, 329.63, 392.00], // Am7 (A3, C4, E4, G4)
    [146.83, 220.00, 261.63, 349.23], // Dm7 (D3, A3, C4, F4)
    [196.00, 246.94, 293.66, 349.23], // G7 (G3, B3, D4, F4)
  ];
  const chordDuration = 2.0;

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const chordIdx = Math.min(3, Math.floor(t / chordDuration));
    const chord = chords[chordIdx];
    const chordTime = t % chordDuration;

    let sampleL = 0;
    let sampleR = 0;

    // Harmonic synth pad
    for (let c = 0; c < chord.length; c++) {
      const freq = chord[c];
      const env = Math.exp(-chordTime * 0.7) * (1 - Math.exp(-chordTime * 20));
      const osc = Math.sin(2 * Math.PI * freq * t) * 0.15;
      const overtone = Math.sin(4 * Math.PI * freq * t + 0.5) * 0.05;
      const val = (osc + overtone) * env;
      
      // Pan each note slightly
      const pan = (c / (chord.length - 1)) * 0.6 - 0.3; // -0.3 to +0.3
      sampleL += val * (0.5 - pan);
      sampleR += val * (0.5 + pan);
    }

    // Warm bassline
    const bassFreq = chord[0] / 2;
    const bassEnv = Math.exp(-chordTime * 1.5) * 0.28;
    const bass = (Math.sin(2 * Math.PI * bassFreq * t) + Math.sin(4 * Math.PI * bassFreq * t) * 0.2) * bassEnv;
    sampleL += bass;
    sampleR += bass;

    // Snare / Hi-hat rhythmic accents on beats (every 0.5s)
    const beatTime = t % 0.5;
    if (beatTime < 0.08) {
      const noise = (Math.random() * 2 - 1) * Math.exp(-beatTime * 45) * 0.12;
      sampleL += noise;
      sampleR += noise;
    }

    // Gentle kick drum on whole beats (0.0s, 1.0s, etc.)
    const kickTime = t % 1.0;
    if (kickTime < 0.2) {
      const kickFreq = 120 * Math.exp(-kickTime * 30) + 40;
      const kick = Math.sin(2 * Math.PI * kickFreq * kickTime) * Math.exp(-kickTime * 15) * 0.35;
      sampleL += kick;
      sampleR += kick;
    }

    left[i] = Math.max(-1, Math.min(1, sampleL));
    right[i] = Math.max(-1, Math.min(1, sampleR));
  }

  return buffer;
}

/**
 * Triggers browser download of a generated Blob
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * Format seconds to standard studio timecode: MM:SS.mmm
 */
export function formatTimecode(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00.000';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

/**
 * Format bytes to readable string (e.g. 2.4 MB)
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
