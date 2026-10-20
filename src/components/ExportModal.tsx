import React, { useState } from 'react';
import { X, Download, RefreshCw, CheckCircle2, Music, Sparkles } from 'lucide-react';
import {
  audioBufferToWav,
  audioBufferToMp3,
  audioBufferToOgg,
  normalizeAudioBuffer,
  sliceAudioBuffer,
  downloadBlob,
  formatBytes,
  formatTimecode,
  getAudioContext,
} from '../utils/audioEngine';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  buffer: AudioBuffer | null;
  currentFilename: string;
  selectionStart: number;
  selectionEnd: number;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  buffer,
  currentFilename,
  selectionStart,
  selectionEnd,
}) => {
  if (!isOpen || !buffer) return null;

  const hasSelection = selectionEnd > selectionStart;
  const defaultBaseName = currentFilename.replace(/\.[^/.]+$/, '') || 'edited_audio';

  const [filename, setFilename] = useState<string>(`${defaultBaseName}_processed`);
  const [format, setFormat] = useState<'mp3' | 'wav' | 'ogg'>('mp3');
  const [exportRange, setExportRange] = useState<'full' | 'selection'>(hasSelection ? 'selection' : 'full');
  const [mp3Bitrate, setMp3Bitrate] = useState<number>(256);
  const [normalize, setNormalize] = useState<boolean>(true);
  const [channels, setChannels] = useState<'stereo' | 'mono'>('stereo');
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);

  const durationToExport =
    exportRange === 'selection' && hasSelection
      ? selectionEnd - selectionStart
      : buffer.duration;

  const handleExport = async () => {
    setIsExporting(true);
    setProgress(0.05);

    try {
      // 1. Slice selection if needed
      let targetBuffer = buffer;
      if (exportRange === 'selection' && hasSelection) {
        targetBuffer = sliceAudioBuffer(buffer, selectionStart, selectionEnd, 'keep', 0.005, 0.005);
      }

      // 2. Normalize if enabled
      if (normalize) {
        targetBuffer = normalizeAudioBuffer(targetBuffer, -0.1);
      }

      // 3. Downmix to Mono if requested
      if (channels === 'mono' && targetBuffer.numberOfChannels > 1) {
        const ctx = getAudioContext();
        const monoBuf = ctx.createBuffer(1, targetBuffer.length, targetBuffer.sampleRate);
        const l = targetBuffer.getChannelData(0);
        const r = targetBuffer.getChannelData(1);
        const m = monoBuf.getChannelData(0);
        for (let i = 0; i < targetBuffer.length; i++) {
          m[i] = (l[i] + r[i]) * 0.5;
        }
        targetBuffer = monoBuf;
      }

      setProgress(0.2);

      // 4. Encode
      let blob: Blob;
      let finalExt: string = format;

      if (format === 'wav') {
        blob = audioBufferToWav(targetBuffer);
        setProgress(1.0);
      } else if (format === 'mp3') {
        blob = await audioBufferToMp3(targetBuffer, mp3Bitrate, (p) => {
          setProgress(0.2 + p * 0.78);
        });
      } else {
        blob = await audioBufferToOgg(targetBuffer, (p) => {
          setProgress(0.2 + p * 0.78);
        });
        finalExt = blob.type.includes('webm') ? 'webm' : 'ogg';
      }

      // 5. Trigger download
      downloadBlob(blob, `${filename.trim() || 'audio'}.${finalExt}`);
      setTimeout(() => {
        setIsExporting(false);
        onClose();
      }, 500);
    } catch (err) {
      console.error('Export failed:', err);
      alert('Failed to export audio.');
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg rounded-xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-slate-950 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-slate-100">Export Processed Audio</h3>
          </div>
          <button
            onClick={onClose}
            disabled={isExporting}
            className="p-1 rounded-md text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-5 space-y-4 text-xs">
          {/* Filename Input */}
          <div>
            <label className="block text-slate-300 font-medium mb-1">Export Filename</label>
            <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 focus-within:border-cyan-500">
              <input
                type="text"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                placeholder="audio_export"
                disabled={isExporting}
                className="w-full bg-transparent text-slate-100 outline-none font-mono text-xs"
              />
              <span className="font-mono text-cyan-400 font-semibold uppercase shrink-0">
                .{format}
              </span>
            </div>
          </div>

          {/* Format Radio Pills */}
          <div>
            <label className="block text-slate-300 font-medium mb-1.5">Audio Format</label>
            <div className="grid grid-cols-3 gap-2">
              {(['mp3', 'wav', 'ogg'] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => setFormat(fmt)}
                  disabled={isExporting}
                  className={`p-2.5 rounded-lg border text-left transition-all ${
                    format === fmt
                      ? 'bg-cyan-500/10 border-cyan-500 text-cyan-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span className="block font-bold text-xs uppercase">{fmt}</span>
                  <span className="block text-[10px] text-slate-500 mt-0.5">
                    {fmt === 'mp3' ? 'Universal Compressed' : fmt === 'wav' ? 'Uncompressed PCM' : 'WebM Opus Stream'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Range: Entire vs Selection */}
          <div>
            <label className="block text-slate-300 font-medium mb-1.5">Export Range</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setExportRange('full')}
                disabled={isExporting}
                className={`p-2.5 rounded-lg border text-left transition-all ${
                  exportRange === 'full'
                    ? 'bg-cyan-500/10 border-cyan-500 text-cyan-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className="block font-semibold">Entire Track</span>
                <span className="block font-mono text-[11px] text-slate-500 mt-0.5">
                  {formatTimecode(buffer.duration)}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setExportRange('selection')}
                disabled={!hasSelection || isExporting}
                className={`p-2.5 rounded-lg border text-left transition-all ${
                  exportRange === 'selection' && hasSelection
                    ? 'bg-cyan-500/10 border-cyan-500 text-cyan-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 disabled:opacity-40'
                }`}
              >
                <span className="block font-semibold">Selection Only</span>
                <span className="block font-mono text-[11px] text-slate-500 mt-0.5">
                  {hasSelection ? formatTimecode(selectionEnd - selectionStart) : 'No selection'}
                </span>
              </button>
            </div>
          </div>

          {/* Conditional MP3 Bitrate */}
          {format === 'mp3' && (
            <div>
              <label className="block text-slate-300 font-medium mb-1">MP3 Quality</label>
              <select
                value={mp3Bitrate}
                onChange={(e) => setMp3Bitrate(parseInt(e.target.value, 10))}
                disabled={isExporting}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-cyan-500"
              >
                <option value="320">320 kbps (High Definition)</option>
                <option value="256">256 kbps (Premium)</option>
                <option value="192">192 kbps (Standard CD)</option>
                <option value="128">128 kbps (Good)</option>
                <option value="64">64 kbps (Voice)</option>
              </select>
            </div>
          )}

          {/* Channels & Normalization */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div>
              <label className="block text-slate-300 font-medium mb-1">Channel Output</label>
              <select
                value={channels}
                onChange={(e) => setChannels(e.target.value as 'stereo' | 'mono')}
                disabled={isExporting}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-cyan-500"
              >
                <option value="stereo">Stereo (2 Channels)</option>
                <option value="mono">Mono Downmix</option>
              </select>
            </div>

            <div className="flex items-center pt-5">
              <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={normalize}
                  onChange={(e) => setNormalize(e.target.checked)}
                  disabled={isExporting}
                  className="rounded border-slate-700 text-cyan-500 focus:ring-0"
                />
                <span>Auto-normalize (-0.1 dBFS)</span>
              </label>
            </div>
          </div>

          {/* Progress Indicator */}
          {isExporting && (
            <div className="space-y-1.5 pt-2">
              <div className="flex items-center justify-between text-xs text-cyan-400 font-mono">
                <span>Encoding {format.toUpperCase()} audio locally...</span>
                <span>{Math.round(progress * 100)}%</span>
              </div>
              <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                <div
                  className="h-full bg-cyan-500 transition-all duration-150"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-3.5 bg-slate-950 border-t border-slate-800">
          <button
            onClick={onClose}
            disabled={isExporting}
            className="px-4 py-2 text-xs font-medium rounded-lg text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-40"
          >
            Cancel
          </button>

          <button
            onClick={handleExport}
            disabled={isExporting}
            className="flex items-center gap-2 px-5 py-2 text-xs font-semibold rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors disabled:opacity-40 shadow-sm"
          >
            {isExporting ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Exporting...</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                <span>Download {format.toUpperCase()}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
