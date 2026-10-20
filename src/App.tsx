/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Waves,
  Scissors,
  Volume2,
  Gauge,
  Sliders,
  RotateCcw,
  Mic,
  Layers,
  FileSpreadsheet,
  Upload,
  Download,
  Play,
  Pause,
  Sparkles,
  ShieldCheck,
  FileAudio,
  Plus
} from 'lucide-react';
import {
  getAudioContext,
  decodeAudioData,
  generateDemoTrack,
  sliceAudioBuffer,
  applyGainToBuffer,
  normalizeAudioBuffer,
  reverseAudioBuffer,
  applyEqualizerToBuffer,
  changeSpeedAndPitch,
  formatBytes,
  formatTimecode,
  EQBand,
  cloneAudioBuffer,
} from './utils/audioEngine';
import { WaveformVisualizer } from './components/WaveformVisualizer';
import { StudioTools, ToolTab } from './components/StudioTools';
import { VoiceRecorder } from './components/VoiceRecorder';
import { AudioJoiner } from './components/AudioJoiner';
import { FileConverter } from './components/FileConverter';
import { ExportModal } from './components/ExportModal';

export type StudioMode = 'editor' | 'joiner' | 'recorder' | 'converter';

export default function App() {
  // Navigation mode
  const [currentMode, setCurrentMode] = useState<StudioMode>('editor');
  const [activeToolTab, setActiveToolTab] = useState<ToolTab>('trim');

  // Audio Editor State
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [currentFilename, setCurrentFilename] = useState<string>('Untitled.wav');
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isLooping, setIsLooping] = useState<boolean>(false);
  const [selectionStart, setSelectionStart] = useState<number>(0);
  const [selectionEnd, setSelectionEnd] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);

  // History stack for Undo / Redo
  const [history, setHistory] = useState<AudioBuffer[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  // Web Audio Nodes References for live playback
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const eqNodesRef = useRef<BiquadFilterNode[]>([]);
  const playbackStartTimeRef = useRef<number>(0);
  const playbackOffsetRef = useRef<number>(0);
  const animFrameRef = useRef<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Push new state to history
  const pushHistory = (newBuffer: AudioBuffer) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(cloneAudioBuffer(newBuffer));
    // Keep max 10 steps to conserve memory
    if (newHistory.length > 10) newHistory.shift();
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setAudioBuffer(newBuffer);
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      stopPlayback();
      const prevIdx = historyIndex - 1;
      const targetBuffer = cloneAudioBuffer(history[prevIdx]);
      setHistoryIndex(prevIdx);
      setAudioBuffer(targetBuffer);
      setSelectionStart(0);
      setSelectionEnd(targetBuffer.duration);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      stopPlayback();
      const nextIdx = historyIndex + 1;
      const targetBuffer = cloneAudioBuffer(history[nextIdx]);
      setHistoryIndex(nextIdx);
      setAudioBuffer(targetBuffer);
      setSelectionStart(0);
      setSelectionEnd(targetBuffer.duration);
    }
  };

  // Keyboard shortcuts (Space = Play/Pause, Ctrl+Z = Undo, Ctrl+Y = Redo)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, audioBuffer, historyIndex, history]);

  // Load a new AudioBuffer into the Editor
  const loadAudioBuffer = (buffer: AudioBuffer, filename = 'Audio_Track.wav') => {
    stopPlayback();
    setAudioBuffer(buffer);
    setCurrentFilename(filename);
    setCurrentTime(0);
    setSelectionStart(0);
    setSelectionEnd(buffer.duration);

    // Reset history with this as initial state
    setHistory([cloneAudioBuffer(buffer)]);
    setHistoryIndex(0);
    setCurrentMode('editor');
  };

  // Load Built-in Demo Track
  const handleLoadDemo = () => {
    const demo = generateDemoTrack();
    loadAudioBuffer(demo, 'Studio_Demo_Groove.wav');
  };

  // File Upload Handlers
  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      await processSelectedFile(files[0]);
    }
  };

  const processSelectedFile = async (file: File) => {
    setIsProcessing(true);
    try {
      const buffer = await decodeAudioData(file);
      loadAudioBuffer(buffer, file.name);
    } catch (err) {
      console.error('Error decoding file:', err);
      alert('Could not decode audio file. Please try another MP3, WAV, or OGG file.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Playback Control Engine
  const startPlayback = (startOffset = currentTime) => {
    if (!audioBuffer) return;

    stopPlayback();
    const ctx = getAudioContext();

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;

    const gainNode = ctx.createGain();
    const analyserNode = ctx.createAnalyser();
    analyserNode.fftSize = 256;

    source.connect(gainNode);
    gainNode.connect(analyserNode);
    analyserNode.connect(ctx.destination);

    gainNodeRef.current = gainNode;
    analyserNodeRef.current = analyserNode;
    audioSourceRef.current = source;

    const duration = audioBuffer.duration;
    let actualStart = startOffset;

    // If selection active and loop enabled or starting outside, handle bounds
    if (isLooping && selectionEnd > selectionStart) {
      if (actualStart < selectionStart || actualStart >= selectionEnd) {
        actualStart = selectionStart;
      }
    } else if (actualStart >= duration) {
      actualStart = 0;
    }

    source.start(0, actualStart);
    playbackStartTimeRef.current = ctx.currentTime;
    playbackOffsetRef.current = actualStart;
    setIsPlaying(true);

    // Animation frame timer for silky smooth playhead movement
    const updatePlayhead = () => {
      if (!source) return;
      const elapsed = ctx.currentTime - playbackStartTimeRef.current;
      let currentPos = playbackOffsetRef.current + elapsed;

      // Handle Looping
      if (isLooping) {
        if (selectionEnd > selectionStart && currentPos >= selectionEnd) {
          source.stop();
          startPlayback(selectionStart);
          return;
        } else if (currentPos >= duration) {
          source.stop();
          startPlayback(0);
          return;
        }
      } else {
        if (currentPos >= duration) {
          stopPlayback();
          setCurrentTime(0);
          return;
        }
      }

      setCurrentTime(currentPos);
      animFrameRef.current = requestAnimationFrame(updatePlayhead);
    };

    animFrameRef.current = requestAnimationFrame(updatePlayhead);

    source.onended = () => {
      // If natural finish without loop
      if (!isLooping) {
        setIsPlaying(false);
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      }
    };
  };

  const stopPlayback = () => {
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.stop();
      } catch {
        // already stopped
      }
      audioSourceRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setIsPlaying(false);
  };

  const togglePlay = () => {
    if (isPlaying) {
      stopPlayback();
    } else {
      startPlayback(currentTime);
    }
  };

  const handleSeek = (newTime: number) => {
    const wasPlaying = isPlaying;
    stopPlayback();
    setCurrentTime(newTime);
    if (wasPlaying) {
      startPlayback(newTime);
    }
  };

  const handleStopAndReset = () => {
    stopPlayback();
    setCurrentTime(0);
  };

  // DSP Actions from StudioTools
  const handleApplyTrim = (mode: 'keep' | 'cut', fadeIn: number, fadeOut: number) => {
    if (!audioBuffer) return;
    setIsProcessing(true);
    stopPlayback();

    try {
      const trimmed = sliceAudioBuffer(
        audioBuffer,
        selectionStart,
        selectionEnd,
        mode,
        fadeIn,
        fadeOut
      );
      pushHistory(trimmed);
      setCurrentTime(0);
      setSelectionStart(0);
      setSelectionEnd(trimmed.duration);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Trim failed';
      alert(msg);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApplyGain = (gainFactor: number, applyToSelectionOnly: boolean) => {
    if (!audioBuffer) return;
    setIsProcessing(true);
    stopPlayback();

    try {
      const range =
        applyToSelectionOnly && selectionEnd > selectionStart
          ? { start: selectionStart, end: selectionEnd }
          : undefined;
      const boosted = applyGainToBuffer(audioBuffer, gainFactor, range);
      pushHistory(boosted);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleNormalize = () => {
    if (!audioBuffer) return;
    setIsProcessing(true);
    stopPlayback();

    try {
      const normalized = normalizeAudioBuffer(audioBuffer, -0.1);
      pushHistory(normalized);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApplySpeedPitch = async (
    speed: number,
    semitones: number,
    cents: number,
    preservePitch: boolean
  ) => {
    if (!audioBuffer) return;
    setIsProcessing(true);
    stopPlayback();

    try {
      const modified = await changeSpeedAndPitch(
        audioBuffer,
        speed,
        semitones,
        cents,
        preservePitch
      );
      pushHistory(modified);
      setCurrentTime(0);
      setSelectionStart(0);
      setSelectionEnd(modified.duration);
    } catch (err) {
      console.error('Failed to apply speed/pitch:', err);
      alert('Error adjusting speed or pitch.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApplyEqualizer = async (bands: EQBand[]) => {
    if (!audioBuffer) return;
    setIsProcessing(true);
    stopPlayback();

    try {
      const eqApplied = await applyEqualizerToBuffer(audioBuffer, bands);
      pushHistory(eqApplied);
    } catch (err) {
      console.error('Failed to apply EQ:', err);
      alert('Error applying equalizer.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApplyReverse = (selectionOnly: boolean, pingPong = false) => {
    if (!audioBuffer) return;
    setIsProcessing(true);
    stopPlayback();

    try {
      if (pingPong) {
        // Concatenate original forward + reversed
        const rev = reverseAudioBuffer(audioBuffer);
        const ctx = getAudioContext();
        const totalSamples = audioBuffer.length + rev.length;
        const pingPongBuf = ctx.createBuffer(
          audioBuffer.numberOfChannels,
          totalSamples,
          audioBuffer.sampleRate
        );

        for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
          const dest = pingPongBuf.getChannelData(ch);
          dest.set(audioBuffer.getChannelData(ch), 0);
          dest.set(rev.getChannelData(ch), audioBuffer.length);
        }

        pushHistory(pingPongBuf);
        setSelectionStart(0);
        setSelectionEnd(pingPongBuf.duration);
      } else {
        const range =
          selectionOnly && selectionEnd > selectionStart
            ? { start: selectionStart, end: selectionEnd }
            : undefined;
        const reversed = reverseAudioBuffer(audioBuffer, range);
        pushHistory(reversed);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col antialiased">
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            processSelectedFile(e.target.files[0]);
          }
        }}
        className="hidden"
      />

      {/* TOP NAVIGATION BAR - Three-Zone Contract */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 bg-slate-950/95 border-b border-slate-800 sticky top-0 z-40 backdrop-blur-md">
        {/* Zone 1: Single Wordmark Brand */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
            <Waves className="w-4 h-4" />
          </div>
          <span className="text-base font-bold tracking-tight text-white whitespace-nowrap">
            AuraWave Studio
          </span>
        </div>

        {/* Zone 2: Navigation Links / Studio Modes */}
        <nav className="flex items-center gap-1 sm:gap-2 overflow-x-auto text-xs font-medium">
          <button
            onClick={() => setCurrentMode('editor')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
              currentMode === 'editor'
                ? 'bg-slate-900 text-cyan-400 border border-slate-800 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Studio Editor
          </button>

          <button
            onClick={() => setCurrentMode('joiner')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
              currentMode === 'joiner'
                ? 'bg-slate-900 text-cyan-400 border border-slate-800 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Audio Joiner
          </button>

          <button
            onClick={() => setCurrentMode('recorder')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
              currentMode === 'recorder'
                ? 'bg-slate-900 text-cyan-400 border border-slate-800 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Voice Recorder
          </button>

          <button
            onClick={() => setCurrentMode('converter')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
              currentMode === 'converter'
                ? 'bg-slate-900 text-cyan-400 border border-slate-800 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            File Converter
          </button>
        </nav>

        {/* Zone 3: Primary Action Button */}
        <div className="flex items-center gap-2.5 shrink-0">
          {audioBuffer ? (
            <button
              onClick={() => setIsExportModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors shadow-sm whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Audio</span>
            </button>
          ) : (
            <button
              onClick={handleLoadDemo}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-cyan-800/60 transition-colors whitespace-nowrap"
            >
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              <span>Load Demo Track</span>
            </button>
          )}
        </div>
      </header>

      {/* MAIN VIEWPORT */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* VIEW 1: STUDIO EDITOR */}
        {currentMode === 'editor' && (
          <>
            {audioBuffer ? (
              <div className="space-y-6">
                {/* File Metadata Bar */}
                <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-md">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-slate-800 border border-slate-700/60 flex items-center justify-center text-cyan-400">
                      <FileAudio className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                        <span>{currentFilename}</span>
                      </h2>
                      <div className="flex items-center gap-2 text-xs text-slate-400 font-mono mt-0.5">
                        <span>{formatTimecode(audioBuffer.duration)}</span>
                        <span>·</span>
                        <span>{audioBuffer.sampleRate} Hz</span>
                        <span>·</span>
                        <span>{audioBuffer.numberOfChannels === 2 ? 'Stereo' : 'Mono'}</span>
                        <span>·</span>
                        <span className="text-emerald-400 flex items-center gap-1 font-sans">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>100% Local Browser Memory</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                    >
                      Open Different File
                    </button>
                    <button
                      onClick={() => setIsExportModalOpen(true)}
                      className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors shadow-sm"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Export</span>
                    </button>
                  </div>
                </div>

                {/* Waveform Visualizer */}
                <WaveformVisualizer
                  buffer={audioBuffer}
                  currentTime={currentTime}
                  isPlaying={isPlaying}
                  onSeek={handleSeek}
                  onTogglePlay={togglePlay}
                  onStop={handleStopAndReset}
                  selectionStart={selectionStart}
                  selectionEnd={selectionEnd}
                  onSelectionChange={(start, end) => {
                    setSelectionStart(start);
                    setSelectionEnd(end);
                  }}
                  isLooping={isLooping}
                  onToggleLoop={() => setIsLooping(!isLooping)}
                  analyserNode={analyserNodeRef.current}
                />

                {/* Studio Editing Tools Tabs */}
                <StudioTools
                  activeTab={activeToolTab}
                  onTabChange={setActiveToolTab}
                  selectionStart={selectionStart}
                  selectionEnd={selectionEnd}
                  duration={audioBuffer.duration}
                  onApplyTrim={handleApplyTrim}
                  onApplyGain={handleApplyGain}
                  onNormalize={handleNormalize}
                  onApplySpeedPitch={handleApplySpeedPitch}
                  onApplyEqualizer={handleApplyEqualizer}
                  onApplyReverse={handleApplyReverse}
                  canUndo={historyIndex > 0}
                  canRedo={historyIndex < history.length - 1}
                  onUndo={handleUndo}
                  onRedo={handleRedo}
                  isProcessing={isProcessing}
                />
              </div>
            ) : (
              /* Empty State: Drag & Drop Zone */
              <div className="space-y-8 py-6">
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDraggingFile(true);
                  }}
                  onDragLeave={() => setIsDraggingFile(false)}
                  onDrop={handleFileDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex flex-col items-center justify-center p-12 sm:p-16 rounded-2xl border-2 border-dashed cursor-pointer transition-all ${
                    isDraggingFile
                      ? 'border-cyan-400 bg-cyan-950/20 scale-[1.005]'
                      : 'border-slate-800 hover:border-slate-700 bg-slate-900/40 hover:bg-slate-900/80 shadow-2xl'
                  }`}
                >
                  <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-4 text-cyan-400 shadow-inner">
                    <Upload className="w-8 h-8" />
                  </div>
                  <h2 className="text-xl font-bold text-white tracking-tight text-center">
                    Drag and drop audio file here to start editing
                  </h2>
                  <p className="text-sm text-slate-400 mt-2 max-w-md text-center">
                    Trim, amplify, change speed & pitch, apply 7-band EQ, reverse, and convert to MP3, WAV, or OGG.
                  </p>

                  <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                      className="px-5 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs shadow-md transition-colors"
                    >
                      Browse Audio Files
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleLoadDemo();
                      }}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Try Built-in Demo Groove</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-slate-500 mt-8 pt-6 border-t border-slate-800/60">
                    <span>Supports MP3, WAV, OGG, M4A, FLAC</span>
                    <span>·</span>
                    <span>100% Client-Side Privacy</span>
                  </div>
                </div>

                {/* Feature Cards Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1.5">
                    <div className="flex items-center gap-2 text-cyan-400">
                      <Scissors className="w-4 h-4" />
                      <h4 className="text-xs font-semibold text-slate-200">Trim & Cut Audio</h4>
                    </div>
                    <p className="text-xs text-slate-400">
                      Crop selections with millisecond precision, smooth edge fades, and waveform zoom.
                    </p>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1.5">
                    <div className="flex items-center gap-2 text-cyan-400">
                      <Gauge className="w-4 h-4" />
                      <h4 className="text-xs font-semibold text-slate-200">Speed & Pitch Shift</h4>
                    </div>
                    <p className="text-xs text-slate-400">
                      Change tempo from 0.25x to 3x with SOLA time-stretching or transpose musical keys.
                    </p>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1.5">
                    <div className="flex items-center gap-2 text-cyan-400">
                      <Sliders className="w-4 h-4" />
                      <h4 className="text-xs font-semibold text-slate-200">7-Band Equalizer</h4>
                    </div>
                    <p className="text-xs text-slate-400">
                      Fine-tune sub bass, vocals, and brilliance with presets like Bass Boost and Vocal Clarify.
                    </p>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1.5">
                    <div className="flex items-center gap-2 text-cyan-400">
                      <RotateCcw className="w-4 h-4" />
                      <h4 className="text-xs font-semibold text-slate-200">Reverse & FX</h4>
                    </div>
                    <p className="text-xs text-slate-400">
                      Create backward swell effects, ping-pong loops, and normalize peak loudness.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* VIEW 2: AUDIO JOINER */}
        {currentMode === 'joiner' && (
          <AudioJoiner onLoadIntoEditor={loadAudioBuffer} />
        )}

        {/* VIEW 3: VOICE RECORDER */}
        {currentMode === 'recorder' && (
          <VoiceRecorder onLoadIntoEditor={loadAudioBuffer} />
        )}

        {/* VIEW 4: FILE CONVERTER */}
        {currentMode === 'converter' && (
          <FileConverter onLoadIntoEditor={loadAudioBuffer} />
        )}
      </main>

      {/* EXPORT MODAL */}
      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        buffer={audioBuffer}
        currentFilename={currentFilename}
        selectionStart={selectionStart}
        selectionEnd={selectionEnd}
      />

      {/* FOOTER */}
      <footer className="mt-auto border-t border-slate-900 py-4 px-6 text-xs text-slate-500 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span>AuraWave Audio Studio</span>
          <span>·</span>
          <span>Web Audio API</span>
          <span>·</span>
          <span>Zero Server Uploads</span>
        </div>
        <div>
          <span>Export formats: MP3, WAV, OGG</span>
        </div>
      </footer>
    </div>
  );
}
