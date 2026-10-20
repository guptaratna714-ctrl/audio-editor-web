import React, { useState, useRef, useEffect } from 'react';
import {
  Layers,
  Upload,
  Play,
  Pause,
  ArrowUp,
  ArrowDown,
  Trash2,
  Volume2,
  Download,
  Send,
  Plus,
  Sparkles
} from 'lucide-react';
import {
  decodeAudioData,
  joinAudioBuffers,
  audioBufferToWav,
  audioBufferToMp3,
  audioBufferToOgg,
  downloadBlob,
  formatTimecode,
  formatBytes,
  getAudioContext,
} from '../utils/audioEngine';

interface JoinTrack {
  id: string;
  file: File;
  name: string;
  buffer: AudioBuffer;
  volume: number; // 0.0 to 2.0
  duration: number;
}

interface AudioJoinerProps {
  onLoadIntoEditor: (buffer: AudioBuffer, filename: string) => void;
}

export const AudioJoiner: React.FC<AudioJoinerProps> = ({ onLoadIntoEditor }) => {
  const [tracks, setTracks] = useState<JoinTrack[]>([]);
  const [crossfadeSec, setCrossfadeSec] = useState<number>(0.5);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);

  // Playback state for previewing joined output
  const [isPlayingJoined, setIsPlayingJoined] = useState<boolean>(false);
  const [previewTrackId, setPreviewTrackId] = useState<string | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const singleAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Stop playback on unmount
  useEffect(() => {
    return () => {
      stopJoinedPlayback();
      stopSingleTrackPlayback();
    };
  }, []);

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsProcessing(true);

    try {
      const newTracks: JoinTrack[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.type.startsWith('audio') && !file.name.match(/\.(mp3|wav|ogg|m4a|aac|flac)$/i)) {
          continue;
        }
        const buffer = await decodeAudioData(file);
        newTracks.push({
          id: 'track_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
          file,
          name: file.name,
          buffer,
          volume: 1.0,
          duration: buffer.duration,
        });
      }
      setTracks((prev) => [...prev, ...newTracks]);
    } catch (err) {
      console.error('Failed to decode one or more files:', err);
      alert('Error reading audio files. Please make sure the files are valid audio formats.');
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const moveTrack = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= tracks.length) return;
    const updated = [...tracks];
    const temp = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = temp;
    setTracks(updated);
  };

  const removeTrack = (id: string) => {
    setTracks((prev) => prev.filter((t) => t.id !== id));
    if (previewTrackId === id) {
      stopSingleTrackPlayback();
    }
  };

  const updateTrackVolume = (id: string, vol: number) => {
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, volume: vol } : t)));
  };

  // Play / Stop single track preview
  const togglePlaySingleTrack = (track: JoinTrack) => {
    if (previewTrackId === track.id) {
      stopSingleTrackPlayback();
    } else {
      stopSingleTrackPlayback();
      stopJoinedPlayback();

      const ctx = getAudioContext();
      const source = ctx.createBufferSource();
      source.buffer = track.buffer;

      const gain = ctx.createGain();
      gain.gain.value = track.volume;

      source.connect(gain);
      gain.connect(ctx.destination);
      source.start();

      source.onended = () => setPreviewTrackId(null);
      singleAudioSourceRef.current = source;
      setPreviewTrackId(track.id);
    }
  };

  const stopSingleTrackPlayback = () => {
    if (singleAudioSourceRef.current) {
      try {
        singleAudioSourceRef.current.stop();
      } catch {
        // already stopped
      }
      singleAudioSourceRef.current = null;
    }
    setPreviewTrackId(null);
  };

  // Calculate joined audio buffer
  const getJoinedBuffer = (): AudioBuffer | null => {
    if (tracks.length === 0) return null;
    return joinAudioBuffers(
      tracks.map((t) => ({ buffer: t.buffer, volume: t.volume })),
      crossfadeSec
    );
  };

  // Master Joined Preview
  const togglePlayJoined = () => {
    if (isPlayingJoined) {
      stopJoinedPlayback();
    } else {
      stopSingleTrackPlayback();
      const joined = getJoinedBuffer();
      if (!joined) return;

      const ctx = getAudioContext();
      const source = ctx.createBufferSource();
      source.buffer = joined;
      source.connect(ctx.destination);
      source.start();

      source.onended = () => setIsPlayingJoined(false);
      audioSourceRef.current = source;
      setIsPlayingJoined(true);
    }
  };

  const stopJoinedPlayback = () => {
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.stop();
      } catch {
        // already stopped
      }
      audioSourceRef.current = null;
    }
    setIsPlayingJoined(false);
  };

  // Export joined mix
  const handleExportJoined = async (format: 'wav' | 'mp3' | 'ogg') => {
    const joined = getJoinedBuffer();
    if (!joined) return;
    setIsProcessing(true);

    try {
      let blob: Blob;
      let extension: string = format;
      if (format === 'wav') {
        blob = audioBufferToWav(joined);
      } else if (format === 'mp3') {
        blob = await audioBufferToMp3(joined, 256);
      } else {
        blob = await audioBufferToOgg(joined);
        extension = blob.type.includes('webm') ? 'webm' : 'ogg';
      }
      downloadBlob(blob, `joined_mix_${Date.now()}.${extension}`);
    } catch (err) {
      console.error('Export failed:', err);
      alert('Failed to export audio.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Send joined result to studio editor
  const handleSendToEditor = () => {
    const joined = getJoinedBuffer();
    if (!joined) return;
    stopJoinedPlayback();
    stopSingleTrackPlayback();
    onLoadIntoEditor(joined, `joined_${tracks.length}_tracks.wav`);
  };

  // Total calculated length with crossfade
  const totalDuration = tracks.reduce((acc, t) => acc + t.duration, 0) - Math.max(0, tracks.length - 1) * crossfadeSec;

  return (
    <div className="space-y-6">
      {/* Upload & Drop Zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingOver(true);
        }}
        onDragLeave={() => setIsDraggingOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDraggingOver(false);
          handleFilesSelected(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={`flex flex-col items-center justify-center p-8 rounded-xl border-2 border-dashed cursor-pointer transition-all ${
          isDraggingOver
            ? 'border-cyan-400 bg-cyan-950/20'
            : 'border-slate-800 hover:border-slate-700 bg-slate-900/60 hover:bg-slate-900'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac"
          onChange={(e) => handleFilesSelected(e.target.files)}
          className="hidden"
        />

        <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mb-3 text-cyan-400">
          <Layers className="w-6 h-6" />
        </div>
        <h3 className="text-sm font-semibold text-slate-100">Drag & drop audio files here to join</h3>
        <p className="text-xs text-slate-400 mt-1">
          Supports multiple MP3, WAV, OGG, and M4A tracks · Arranged sequentially with smooth crossfades
        </p>
      </div>

      {/* Tracks Sequence List */}
      {tracks.length > 0 && (
        <div className="rounded-xl bg-slate-900 border border-slate-800 shadow-xl overflow-hidden">
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 bg-slate-950/90 border-b border-slate-800">
            <div>
              <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                Tracks Sequence ({tracks.length})
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Total Joined Duration: <span className="font-mono text-cyan-400 font-medium">{formatTimecode(Math.max(0, totalDuration))}</span>
              </p>
            </div>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add More Tracks</span>
            </button>
          </div>

          {/* Track Items */}
          <div className="divide-y divide-slate-800/60">
            {tracks.map((track, idx) => (
              <div
                key={track.id}
                className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 hover:bg-slate-850/40 transition-colors"
              >
                {/* Track Index, Play button, Name */}
                <div className="flex items-center gap-3 min-w-[200px] flex-1">
                  <span className="font-mono text-xs text-slate-500 w-5">#{idx + 1}</span>

                  <button
                    onClick={() => togglePlaySingleTrack(track)}
                    className="w-8 h-8 rounded-full bg-slate-800 hover:bg-cyan-500 hover:text-slate-950 text-cyan-400 flex items-center justify-center transition-colors shrink-0"
                    title={previewTrackId === track.id ? 'Pause Preview' : 'Preview Track'}
                  >
                    {previewTrackId === track.id ? (
                      <Pause className="w-4 h-4 fill-current" />
                    ) : (
                      <Play className="w-4 h-4 fill-current ml-0.5" />
                    )}
                  </button>

                  <div className="overflow-hidden">
                    <p className="text-sm font-medium text-slate-200 truncate">{track.name}</p>
                    <div className="flex items-center gap-2 text-xs text-slate-500 font-mono mt-0.5">
                      <span>{formatTimecode(track.duration)}</span>
                      <span>·</span>
                      <span>{track.buffer.numberOfChannels === 2 ? 'Stereo' : 'Mono'}</span>
                      <span>·</span>
                      <span>{track.buffer.sampleRate} Hz</span>
                    </div>
                  </div>
                </div>

                {/* Individual Volume Fader */}
                <div className="flex items-center gap-2.5 w-44">
                  <Volume2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <input
                    type="range"
                    min="0"
                    max="1.5"
                    step="0.05"
                    value={track.volume}
                    onChange={(e) => updateTrackVolume(track.id, parseFloat(e.target.value))}
                    className="w-full"
                    title={`Volume: ${Math.round(track.volume * 100)}%`}
                  />
                  <span className="font-mono text-[11px] text-slate-400 w-9 text-right">
                    {Math.round(track.volume * 100)}%
                  </span>
                </div>

                {/* Move & Remove Actions */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => moveTrack(idx, 'up')}
                    disabled={idx === 0}
                    className="p-1.5 text-slate-400 hover:text-slate-200 disabled:opacity-30 rounded hover:bg-slate-800 transition-colors"
                    title="Move Track Up"
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => moveTrack(idx, 'down')}
                    disabled={idx === tracks.length - 1}
                    className="p-1.5 text-slate-400 hover:text-slate-200 disabled:opacity-30 rounded hover:bg-slate-800 transition-colors"
                    title="Move Track Down"
                  >
                    <ArrowDown className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => removeTrack(track.id)}
                    className="p-1.5 text-slate-400 hover:text-rose-400 rounded hover:bg-slate-800 transition-colors ml-1"
                    title="Remove Track"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Crossfade & Master Output Bar */}
          <div className="p-5 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-5">
            {/* Crossfade duration slider */}
            <div className="flex items-center gap-3 w-72">
              <span className="text-xs text-slate-300 font-medium whitespace-nowrap">Crossfade:</span>
              <input
                type="range"
                min="0"
                max="4.0"
                step="0.1"
                value={crossfadeSec}
                onChange={(e) => setCrossfadeSec(parseFloat(e.target.value))}
                className="w-full"
              />
              <span className="font-mono text-xs text-cyan-400 w-12 text-right">
                {crossfadeSec.toFixed(1)}s
              </span>
            </div>

            {/* Master Action Buttons */}
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={togglePlayJoined}
                disabled={isProcessing}
                className="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
              >
                {isPlayingJoined ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                <span>{isPlayingJoined ? 'Pause Preview' : 'Preview Joined Mix'}</span>
              </button>

              <button
                onClick={handleSendToEditor}
                disabled={isProcessing}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors shadow-sm"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Open in Studio Editor</span>
              </button>

              {/* Quick Export Formats */}
              <div className="flex items-center bg-slate-800 rounded-lg p-0.5">
                <button
                  onClick={() => handleExportJoined('wav')}
                  disabled={isProcessing}
                  className="px-2.5 py-1.5 text-xs text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors"
                  title="Export Combined Lossless WAV"
                >
                  WAV
                </button>
                <button
                  onClick={() => handleExportJoined('mp3')}
                  disabled={isProcessing}
                  className="px-2.5 py-1.5 text-xs text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors"
                  title="Export Combined MP3 (256 kbps)"
                >
                  MP3
                </button>
                <button
                  onClick={() => handleExportJoined('ogg')}
                  disabled={isProcessing}
                  className="px-2.5 py-1.5 text-xs text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors"
                  title="Export Combined OGG"
                >
                  OGG
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
