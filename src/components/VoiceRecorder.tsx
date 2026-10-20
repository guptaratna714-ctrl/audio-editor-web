import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Square, Play, Pause, Download, Send, RefreshCw, Settings2, Trash2 } from 'lucide-react';
import {
  getAudioContext,
  decodeAudioData,
  audioBufferToWav,
  audioBufferToMp3,
  audioBufferToOgg,
  downloadBlob,
  formatTimecode,
  formatBytes,
} from '../utils/audioEngine';

interface VoiceRecorderProps {
  onLoadIntoEditor: (buffer: AudioBuffer, filename: string) => void;
}

interface RecordedTake {
  id: string;
  name: string;
  blob: Blob;
  buffer: AudioBuffer;
  duration: number;
  timestamp: Date;
}

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({ onLoadIntoEditor }) => {
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [recordTime, setRecordTime] = useState<number>(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [takes, setTakes] = useState<RecordedTake[]>([]);
  const [previewingTakeId, setPreviewingTakeId] = useState<string | null>(null);

  // Audio constraints
  const [noiseSuppression, setNoiseSuppression] = useState<boolean>(true);
  const [echoCancellation, setEchoCancellation] = useState<boolean>(true);
  const [autoGain, setAutoGain] = useState<boolean>(true);
  const [showSettings, setShowSettings] = useState<boolean>(false);

  // References
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<number | null>(null);
  const visualizerCanvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number | null>(null);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);

  // Live audio metering
  const analyserRef = useRef<AnalyserNode | null>(null);
  const [vuLevel, setVuLevel] = useState<number>(0);

  // Enumerate microphones
  useEffect(() => {
    async function loadDevices() {
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devs.filter((d) => d.kind === 'audioinput');
        setDevices(audioInputs);
        if (audioInputs.length > 0 && !selectedDeviceId) {
          setSelectedDeviceId(audioInputs[0].deviceId);
        }
      } catch {
        // Ignored if permissions not yet granted
      }
    }
    loadDevices();
  }, [selectedDeviceId]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopTracks();
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  const stopTracks = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
  };

  // Start Voice Recording
  const startRecording = async () => {
    try {
      stopTracks();

      const constraints: MediaStreamConstraints = {
        audio: {
          deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
          noiseSuppression,
          echoCancellation,
          autoGainControl: autoGain,
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      mediaStreamRef.current = stream;

      // Setup Web Audio Analyser for live visualizer & VU meter
      const ctx = getAudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Setup MediaRecorder
      const mimeTypes = ['audio/webm; codecs=opus', 'audio/ogg; codecs=opus', 'audio/webm', 'audio/mp4'];
      const chosenMime = mimeTypes.find((m) => MediaRecorder.isTypeSupported(m)) || '';

      const recorder = new MediaRecorder(stream, chosenMime ? { mimeType: chosenMime } : undefined);
      mediaRecorderRef.current = recorder;
      recordedChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        const fullBlob = new Blob(recordedChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        stopTracks();

        try {
          const buffer = await decodeAudioData(fullBlob);
          const newTake: RecordedTake = {
            id: 'take_' + Date.now(),
            name: `Voice Take ${takes.length + 1}`,
            blob: fullBlob,
            buffer,
            duration: buffer.duration,
            timestamp: new Date(),
          };
          setTakes((prev) => [newTake, ...prev]);
        } catch (err) {
          console.error('Failed to decode recorded audio:', err);
        }
      };

      recorder.start(100);
      setIsRecording(true);
      setIsPaused(false);
      setRecordTime(0);

      // Timer
      const startTime = Date.now();
      timerIntervalRef.current = window.setInterval(() => {
        setRecordTime((Date.now() - startTime) / 1000);
      }, 50);

      // Start Visualizer Canvas loop
      drawLiveVisualizer();
    } catch (err) {
      console.error('Microphone access failed:', err);
      alert('Could not access microphone. Please grant microphone permissions in browser.');
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      if (isPaused) {
        mediaRecorderRef.current.resume();
        setIsPaused(false);
      } else {
        mediaRecorderRef.current.pause();
        setIsPaused(true);
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      setVuLevel(0);
    }
  };

  // Draw live oscilloscope and frequency wave
  const drawLiveVisualizer = () => {
    const canvas = visualizerCanvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.fftSize;
    const timeData = new Float32Array(bufferLength);

    const render = () => {
      animFrameRef.current = requestAnimationFrame(render);
      analyser.getFloatTimeDomainData(timeData);

      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      // Calculate peak VU level
      let peak = 0;
      for (let i = 0; i < bufferLength; i++) {
        const abs = Math.abs(timeData[i]);
        if (abs > peak) peak = abs;
      }
      setVuLevel(peak);

      // Draw oscilloscope waveform
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#22d3ee';
      ctx.shadowColor = '#06b6d4';
      ctx.shadowBlur = 8;
      ctx.beginPath();

      const sliceWidth = width / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = timeData[i];
        const y = (0.5 + v * 0.45) * height;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        x += sliceWidth;
      }

      ctx.lineTo(width, height / 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    };

    render();
  };

  // Playback Take preview
  const handleTogglePreviewTake = (take: RecordedTake) => {
    if (previewingTakeId === take.id) {
      if (audioPreviewRef.current) {
        audioPreviewRef.current.pause();
      }
      setPreviewingTakeId(null);
    } else {
      if (audioPreviewRef.current) {
        audioPreviewRef.current.pause();
      }
      const url = URL.createObjectURL(take.blob);
      const audio = new Audio(url);
      audioPreviewRef.current = audio;
      setPreviewingTakeId(take.id);
      audio.play();
      audio.onended = () => setPreviewingTakeId(null);
    }
  };

  // Export take directly
  const handleDownloadTake = async (take: RecordedTake, format: 'wav' | 'mp3' | 'ogg') => {
    let blob: Blob;
    let extension: string = format;
    if (format === 'wav') {
      blob = audioBufferToWav(take.buffer);
    } else if (format === 'mp3') {
      blob = await audioBufferToMp3(take.buffer, 192);
    } else {
      blob = await audioBufferToOgg(take.buffer);
      extension = blob.type.includes('webm') ? 'webm' : 'ogg';
    }
    downloadBlob(blob, `${take.name.toLowerCase().replace(/\s+/g, '_')}.${extension}`);
  };

  return (
    <div className="space-y-6">
      {/* Recording Console */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 shadow-xl overflow-hidden">
        {/* Console Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 bg-slate-950/90 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Live Voice & Mic Recorder</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Record vocals, podcasts, or instruments with direct studio integration.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            >
              <Settings2 className="w-3.5 h-3.5" />
              <span>Mic Settings</span>
            </button>
          </div>
        </div>

        {/* Collapsible Audio Hardware Settings */}
        {showSettings && (
          <div className="p-4 bg-slate-950 border-b border-slate-800 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            <div>
              <span className="block text-slate-400 mb-1">Microphone Input</span>
              <select
                value={selectedDeviceId}
                onChange={(e) => setSelectedDeviceId(e.target.value)}
                disabled={isRecording}
                className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200 outline-none focus:border-cyan-500"
              >
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Microphone ${d.deviceId.slice(0, 5)}`}
                  </option>
                ))}
                {devices.length === 0 && <option value="">Default Microphone</option>}
              </select>
            </div>

            <label className="flex items-center gap-2 text-slate-300 cursor-pointer pt-4">
              <input
                type="checkbox"
                checked={noiseSuppression}
                onChange={(e) => setNoiseSuppression(e.target.checked)}
                disabled={isRecording}
                className="rounded border-slate-700 text-cyan-500 focus:ring-0"
              />
              <span>Noise Suppression</span>
            </label>

            <label className="flex items-center gap-2 text-slate-300 cursor-pointer pt-4">
              <input
                type="checkbox"
                checked={echoCancellation}
                onChange={(e) => setEchoCancellation(e.target.checked)}
                disabled={isRecording}
                className="rounded border-slate-700 text-cyan-500 focus:ring-0"
              />
              <span>Echo Cancellation</span>
            </label>

            <label className="flex items-center gap-2 text-slate-300 cursor-pointer pt-4">
              <input
                type="checkbox"
                checked={autoGain}
                onChange={(e) => setAutoGain(e.target.checked)}
                disabled={isRecording}
                className="rounded border-slate-700 text-cyan-500 focus:ring-0"
              />
              <span>Auto Gain Control</span>
            </label>
          </div>
        )}

        {/* Live Visualizer Stage */}
        <div className="p-6 bg-slate-950 flex flex-col items-center justify-center relative overflow-hidden min-h-[220px]">
          {/* Animated Background Canvas */}
          <canvas
            ref={visualizerCanvasRef}
            width={700}
            height={160}
            className="w-full max-w-2xl h-[120px] rounded-lg"
          />

          {!isRecording && (
            <div className="text-center py-4">
              <div className="w-14 h-14 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto mb-3 text-cyan-400 shadow-inner">
                <Mic className="w-7 h-7" />
              </div>
              <p className="text-xs text-slate-400">Click the red button below to start voice recording</p>
            </div>
          )}

          {/* Recording Timer & Status */}
          {isRecording && (
            <div className="flex flex-col items-center gap-2 mt-4">
              <div className="flex items-center gap-2 font-mono text-3xl font-bold text-white tracking-wider">
                <span className="w-3 h-3 rounded-full bg-rose-500 animate-pulse" />
                <span>{formatTimecode(recordTime)}</span>
              </div>
              <span className="text-xs text-slate-400">
                {isPaused ? 'Recording Paused' : 'Recording in Progress...'}
              </span>

              {/* Dynamic VU Meter */}
              <div className="w-64 h-2 bg-slate-900 rounded-full overflow-hidden mt-1 border border-slate-800">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 via-amber-400 to-rose-500 transition-all duration-75"
                  style={{ width: `${Math.min(100, vuLevel * 180)}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Master Recording Controls */}
        <div className="flex flex-wrap items-center justify-center gap-4 px-6 py-5 bg-slate-900/90 border-t border-slate-800">
          {!isRecording ? (
            <button
              onClick={startRecording}
              className="flex items-center gap-2.5 px-6 py-3 rounded-full bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-semibold shadow-lg shadow-rose-600/30 transition-all"
            >
              <span className="w-3 h-3 rounded-full bg-white" />
              <span>Record Vocal</span>
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <button
                onClick={pauseRecording}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
              >
                {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                <span>{isPaused ? 'Resume' : 'Pause'}</span>
              </button>

              <button
                onClick={stopRecording}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold transition-colors"
              >
                <Square className="w-4 h-4 fill-current" />
                <span>Stop & Save Take</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Recorded Takes History */}
      {takes.length > 0 && (
        <div className="rounded-xl bg-slate-900 border border-slate-800 shadow-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 bg-slate-950/80 border-b border-slate-800">
            <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
              Recorded Takes ({takes.length})
            </h3>
            <button
              onClick={() => setTakes([])}
              className="text-xs text-slate-500 hover:text-rose-400 transition-colors"
            >
              Clear All
            </button>
          </div>

          <div className="divide-y divide-slate-800/60">
            {takes.map((take) => (
              <div
                key={take.id}
                className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 hover:bg-slate-850/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleTogglePreviewTake(take)}
                    className="w-8 h-8 rounded-full bg-slate-800 hover:bg-cyan-500 hover:text-slate-950 text-cyan-400 flex items-center justify-center transition-colors"
                  >
                    {previewingTakeId === take.id ? (
                      <Pause className="w-4 h-4 fill-current" />
                    ) : (
                      <Play className="w-4 h-4 fill-current ml-0.5" />
                    )}
                  </button>
                  <div>
                    <span className="text-sm font-medium text-slate-200">{take.name}</span>
                    <div className="flex items-center gap-2 text-xs text-slate-500 font-mono mt-0.5">
                      <span>{formatTimecode(take.duration)}</span>
                      <span>·</span>
                      <span>{formatBytes(take.blob.size)}</span>
                      <span>·</span>
                      <span>{take.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onLoadIntoEditor(take.buffer, `${take.name}.wav`)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors shadow-sm"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Open in Studio Editor</span>
                  </button>

                  <div className="flex items-center bg-slate-800 rounded-lg p-0.5">
                    <button
                      onClick={() => handleDownloadTake(take, 'wav')}
                      className="px-2.5 py-1 text-xs text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors"
                      title="Download Lossless WAV"
                    >
                      WAV
                    </button>
                    <button
                      onClick={() => handleDownloadTake(take, 'mp3')}
                      className="px-2.5 py-1 text-xs text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors"
                      title="Download MP3"
                    >
                      MP3
                    </button>
                    <button
                      onClick={() => handleDownloadTake(take, 'ogg')}
                      className="px-2.5 py-1 text-xs text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors"
                      title="Download OGG"
                    >
                      OGG
                    </button>
                  </div>

                  <button
                    onClick={() => setTakes((prev) => prev.filter((t) => t.id !== take.id))}
                    className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors"
                    title="Delete Take"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
