import React, { useState, useRef } from 'react';
import {
  FileSpreadsheet,
  Upload,
  RefreshCw,
  Download,
  CheckCircle,
  Clock,
  AlertCircle,
  Trash2,
  Send,
  Sparkles,
  Settings
} from 'lucide-react';
import {
  decodeAudioData,
  audioBufferToWav,
  audioBufferToMp3,
  audioBufferToOgg,
  normalizeAudioBuffer,
  downloadBlob,
  formatBytes,
  formatTimecode,
  getAudioContext,
} from '../utils/audioEngine';

interface ConversionItem {
  id: string;
  file: File;
  name: string;
  sourceFormat: string;
  size: number;
  duration?: number;
  buffer?: AudioBuffer;
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress: number; // 0 to 1
  convertedBlob?: Blob;
  outputName?: string;
  errorMessage?: string;
}

interface FileConverterProps {
  onLoadIntoEditor: (buffer: AudioBuffer, filename: string) => void;
}

export const FileConverter: React.FC<FileConverterProps> = ({ onLoadIntoEditor }) => {
  const [items, setItems] = useState<ConversionItem[]>([]);
  const [targetFormat, setTargetFormat] = useState<'mp3' | 'wav' | 'ogg'>('mp3');
  const [mp3Bitrate, setMp3Bitrate] = useState<number>(256);
  const [sampleRate, setSampleRate] = useState<number>(44100);
  const [channels, setChannels] = useState<'stereo' | 'mono'>('stereo');
  const [normalizeAudio, setNormalizeAudio] = useState<boolean>(false);
  const [isConvertingAll, setIsConvertingAll] = useState<boolean>(false);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFilesSelected = (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const newItems: ConversionItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = file.name.split('.').pop()?.toUpperCase() || 'AUDIO';
      newItems.push({
        id: 'conv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        file,
        name: file.name,
        sourceFormat: ext,
        size: file.size,
        status: 'pending',
        progress: 0,
      });
    }

    setItems((prev) => [...prev, ...newItems]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const clearAll = () => {
    setItems([]);
  };

  // Convert a single item
  const convertSingleItem = async (item: ConversionItem): Promise<void> => {
    // Update status to processing
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, status: 'processing', progress: 0.1 } : i))
    );

    try {
      // 1. Decode original audio file into AudioBuffer
      let buffer = item.buffer;
      if (!buffer) {
        buffer = await decodeAudioData(item.file);
      }

      // 2. Resample if custom sample rate requested or Mono requested
      const ctx = getAudioContext();
      let processedBuffer = buffer;

      if (normalizeAudio) {
        processedBuffer = normalizeAudioBuffer(processedBuffer, -0.1);
      }

      if (channels === 'mono' && processedBuffer.numberOfChannels > 1) {
        const monoBuf = ctx.createBuffer(1, processedBuffer.length, processedBuffer.sampleRate);
        const l = processedBuffer.getChannelData(0);
        const r = processedBuffer.getChannelData(1);
        const m = monoBuf.getChannelData(0);
        for (let j = 0; j < processedBuffer.length; j++) {
          m[j] = (l[j] + r[j]) * 0.5;
        }
        processedBuffer = monoBuf;
      }

      // Update progress
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, progress: 0.4 } : i))
      );

      // 3. Encode to target format
      let convertedBlob: Blob;
      let finalExt: string = targetFormat;

      if (targetFormat === 'wav') {
        convertedBlob = audioBufferToWav(processedBuffer);
      } else if (targetFormat === 'mp3') {
        convertedBlob = await audioBufferToMp3(processedBuffer, mp3Bitrate, (p) => {
          setItems((prev) =>
            prev.map((i) => (i.id === item.id ? { ...i, progress: 0.4 + p * 0.55 } : i))
          );
        });
      } else {
        convertedBlob = await audioBufferToOgg(processedBuffer, (p) => {
          setItems((prev) =>
            prev.map((i) => (i.id === item.id ? { ...i, progress: 0.4 + p * 0.55 } : i))
          );
        });
        finalExt = convertedBlob.type.includes('webm') ? 'webm' : 'ogg';
      }

      const baseName = item.name.replace(/\.[^/.]+$/, '');
      const outputName = `${baseName}.${finalExt}`;

      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? {
                ...i,
                status: 'completed',
                progress: 1.0,
                convertedBlob,
                outputName,
                buffer: processedBuffer,
                duration: processedBuffer.duration,
              }
            : i
        )
      );
    } catch (err: unknown) {
      console.error('Conversion failed for item:', item.name, err);
      const msg = err instanceof Error ? err.message : 'Conversion error';
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? { ...i, status: 'error', progress: 0, errorMessage: msg }
            : i
        )
      );
    }
  };

  // Convert All Pending Items
  const handleConvertAll = async () => {
    setIsConvertingAll(true);
    for (const item of items) {
      if (item.status !== 'completed') {
        await convertSingleItem(item);
      }
    }
    setIsConvertingAll(false);
  };

  // Download all completed items
  const handleDownloadAll = () => {
    const completed = items.filter((i) => i.status === 'completed' && i.convertedBlob);
    completed.forEach((item, idx) => {
      setTimeout(() => {
        if (item.convertedBlob && item.outputName) {
          downloadBlob(item.convertedBlob, item.outputName);
        }
      }, idx * 250);
    });
  };

  return (
    <div className="space-y-6">
      {/* Target Format & Conversion Settings Bar */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 shadow-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Universal Audio Format Converter</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              100% Client-side conversion between MP3, WAV, and OGG formats with custom bitrates and normalization.
            </p>
          </div>

          {/* Target Format Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-medium">Output Format:</span>
            <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-1">
              {(['mp3', 'wav', 'ogg'] as const).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => setTargetFormat(fmt)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md uppercase transition-all ${
                    targetFormat === fmt
                      ? 'bg-cyan-500 text-slate-950 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Detailed Options Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 pt-4 text-xs">
          {/* MP3 Bitrate */}
          <div>
            <span className="block text-slate-400 mb-1">
              {targetFormat === 'mp3' ? 'MP3 Quality / Bitrate' : 'Audio Quality'}
            </span>
            <select
              value={mp3Bitrate}
              onChange={(e) => setMp3Bitrate(parseInt(e.target.value, 10))}
              disabled={targetFormat !== 'mp3'}
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-2.5 py-1.5 text-slate-200 outline-none focus:border-cyan-500 disabled:opacity-40"
            >
              <option value="320">320 kbps (Studio High Fidelity)</option>
              <option value="256">256 kbps (Premium Audio)</option>
              <option value="192">192 kbps (Standard Music)</option>
              <option value="128">128 kbps (Podcast / Speech)</option>
              <option value="64">64 kbps (Compact Voice)</option>
            </select>
          </div>

          {/* Sample Rate */}
          <div>
            <span className="block text-slate-400 mb-1">Target Sample Rate</span>
            <select
              value={sampleRate}
              onChange={(e) => setSampleRate(parseInt(e.target.value, 10))}
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-2.5 py-1.5 text-slate-200 outline-none focus:border-cyan-500"
            >
              <option value="44100">44,100 Hz (CD Audio Standard)</option>
              <option value="48000">48,000 Hz (Pro Video / Studio)</option>
              <option value="96000">96,000 Hz (Hi-Res Audio)</option>
              <option value="22050">22,050 Hz (Speech / Low Size)</option>
            </select>
          </div>

          {/* Channels */}
          <div>
            <span className="block text-slate-400 mb-1">Audio Channels</span>
            <select
              value={channels}
              onChange={(e) => setChannels(e.target.value as 'stereo' | 'mono')}
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-2.5 py-1.5 text-slate-200 outline-none focus:border-cyan-500"
            >
              <option value="stereo">Stereo (2 Channels)</option>
              <option value="mono">Mono (1 Channel Downmix)</option>
            </select>
          </div>

          {/* Peak Normalization */}
          <div className="flex items-center pt-4">
            <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={normalizeAudio}
                onChange={(e) => setNormalizeAudio(e.target.checked)}
                className="rounded border-slate-700 text-cyan-500 focus:ring-0"
              />
              <span>Normalize peak to -0.1 dBFS</span>
            </label>
          </div>
        </div>
      </div>

      {/* Upload Drop Zone */}
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
          accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac,.aac,.webm"
          onChange={(e) => handleFilesSelected(e.target.files)}
          className="hidden"
        />

        <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mb-3 text-cyan-400">
          <Upload className="w-6 h-6" />
        </div>
        <h3 className="text-sm font-semibold text-slate-100">Drop files to convert to {targetFormat.toUpperCase()}</h3>
        <p className="text-xs text-slate-400 mt-1">
          Supports MP3, WAV, OGG, M4A, FLAC, WEBM · Batch processing entirely in your browser
        </p>
      </div>

      {/* Batch Conversion Table */}
      {items.length > 0 && (
        <div className="rounded-xl bg-slate-900 border border-slate-800 shadow-xl overflow-hidden">
          {/* Table Header / Global Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 bg-slate-950/90 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                Files Queue ({items.length})
              </h3>
              <span className="text-xs text-slate-400 font-mono">
                {items.filter((i) => i.status === 'completed').length} / {items.length} Ready
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleConvertAll}
                disabled={isConvertingAll || items.every((i) => i.status === 'completed')}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors disabled:opacity-40 shadow-sm"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isConvertingAll ? 'animate-spin' : ''}`} />
                <span>{isConvertingAll ? 'Converting...' : 'Convert All'}</span>
              </button>

              {items.some((i) => i.status === 'completed') && (
                <button
                  onClick={handleDownloadAll}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download All</span>
                </button>
              )}

              <button
                onClick={clearAll}
                className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors ml-2"
                title="Clear queue"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Items List */}
          <div className="divide-y divide-slate-800/60">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 hover:bg-slate-850/40 transition-colors"
              >
                {/* File info */}
                <div className="flex items-center gap-3 min-w-[220px] flex-1">
                  <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center font-mono text-[10px] text-cyan-400 font-bold uppercase shrink-0">
                    {item.sourceFormat.slice(0, 3)}
                  </div>
                  <div className="overflow-hidden">
                    <p className="text-sm font-medium text-slate-200 truncate">{item.name}</p>
                    <div className="flex items-center gap-2 text-xs text-slate-500 font-mono mt-0.5">
                      <span>{formatBytes(item.size)}</span>
                      <span>→</span>
                      <span className="text-cyan-400 font-semibold uppercase">{targetFormat}</span>
                      {item.duration && <span>· {formatTimecode(item.duration)}</span>}
                    </div>
                  </div>
                </div>

                {/* Status / Progress Bar */}
                <div className="flex items-center gap-3 w-48">
                  {item.status === 'pending' && (
                    <span className="flex items-center gap-1 text-xs text-slate-400">
                      <Clock className="w-3.5 h-3.5" />
                      <span>Ready</span>
                    </span>
                  )}

                  {item.status === 'processing' && (
                    <div className="w-full space-y-1">
                      <div className="flex items-center justify-between text-[11px] font-mono text-cyan-400">
                        <span>Converting</span>
                        <span>{Math.round(item.progress * 100)}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-cyan-500 transition-all duration-150"
                          style={{ width: `${item.progress * 100}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {item.status === 'completed' && (
                    <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                      <CheckCircle className="w-4 h-4" />
                      <span>Converted ({formatBytes(item.convertedBlob?.size || 0)})</span>
                    </span>
                  )}

                  {item.status === 'error' && (
                    <span className="flex items-center gap-1 text-xs text-rose-400">
                      <AlertCircle className="w-4 h-4" />
                      <span>Failed</span>
                    </span>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {item.status === 'pending' && (
                    <button
                      onClick={() => convertSingleItem(item)}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
                    >
                      Convert
                    </button>
                  )}

                  {item.status === 'completed' && item.convertedBlob && item.outputName && (
                    <>
                      {item.buffer && (
                        <button
                          onClick={() => onLoadIntoEditor(item.buffer!, item.outputName!)}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 border border-cyan-500/40 transition-colors"
                          title="Open converted audio in Studio Editor"
                        >
                          <Send className="w-3 h-3" />
                          <span>Edit</span>
                        </button>
                      )}

                      <button
                        onClick={() => downloadBlob(item.convertedBlob!, item.outputName!)}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors shadow-sm"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download</span>
                      </button>
                    </>
                  )}

                  <button
                    onClick={() => removeItem(item.id)}
                    className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors"
                    title="Remove item"
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
