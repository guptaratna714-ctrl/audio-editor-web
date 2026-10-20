import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ZoomIn, ZoomOut, Maximize2, Play, Pause, Square, Repeat, Scissors, Volume2 } from 'lucide-react';
import { formatTimecode } from '../utils/audioEngine';

interface WaveformVisualizerProps {
  buffer: AudioBuffer | null;
  currentTime: number;
  isPlaying: boolean;
  onSeek: (time: number) => void;
  onTogglePlay: () => void;
  onStop: () => void;
  selectionStart: number;
  selectionEnd: number;
  onSelectionChange: (start: number, end: number) => void;
  isLooping: boolean;
  onToggleLoop: () => void;
  analyserNode?: AnalyserNode | null;
}

export const WaveformVisualizer: React.FC<WaveformVisualizerProps> = ({
  buffer,
  currentTime,
  isPlaying,
  onSeek,
  onTogglePlay,
  onStop,
  selectionStart,
  selectionEnd,
  onSelectionChange,
  isLooping,
  onToggleLoop,
  analyserNode
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spectrumCanvasRef = useRef<HTMLCanvasElement>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(1); // 1 = fit, 2 = 2x, etc.
  const [scrollLeft, setScrollLeft] = useState<number>(0);
  const [isDraggingSelection, setIsDraggingSelection] = useState<'start' | 'end' | 'middle' | null>(null);
  const [dragAnchor, setDragAnchor] = useState<number>(0);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [showSpectrum, setShowSpectrum] = useState<boolean>(false);

  const duration = buffer ? buffer.duration : 0;

  // Zoom handlers
  const handleZoomIn = () => setZoomLevel((z) => Math.min(16, z * 1.5));
  const handleZoomOut = () => setZoomLevel((z) => Math.max(1, z / 1.5));
  const handleZoomReset = () => {
    setZoomLevel(1);
    setScrollLeft(0);
  };

  // Convert time to pixels based on current zoom and container width
  const getContainerWidth = () => containerRef.current?.clientWidth || 800;
  const totalWaveformWidth = Math.max(getContainerWidth(), getContainerWidth() * zoomLevel);

  const timeToPixel = useCallback((time: number) => {
    if (duration <= 0) return 0;
    return (time / duration) * totalWaveformWidth;
  }, [duration, totalWaveformWidth]);

  const pixelToTime = useCallback((px: number) => {
    if (totalWaveformWidth <= 0 || duration <= 0) return 0;
    return Math.max(0, Math.min(duration, (px / totalWaveformWidth) * duration));
  }, [duration, totalWaveformWidth]);

  // Keep playhead in view when playing and zoomed
  useEffect(() => {
    if (!isPlaying || zoomLevel <= 1 || !containerRef.current) return;
    const playheadPx = timeToPixel(currentTime);
    const container = containerRef.current;
    const viewLeft = container.scrollLeft;
    const viewWidth = container.clientWidth;

    if (playheadPx < viewLeft || playheadPx > viewLeft + viewWidth - 50) {
      container.scrollLeft = playheadPx - viewWidth / 3;
    }
  }, [currentTime, isPlaying, zoomLevel, timeToPixel]);

  // Draw main waveform canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !buffer) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = totalWaveformWidth;
    const height = 180;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    // Background gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, '#090e1a');
    bgGrad.addColorStop(1, '#05070d');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Subtle horizontal center grid line
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    // Time Ruler lines
    const rulerHeight = 22;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, rulerHeight);
    ctx.strokeStyle = '#1e293b';
    ctx.beginPath();
    ctx.moveTo(0, rulerHeight);
    ctx.lineTo(width, rulerHeight);
    ctx.stroke();

    // Dynamic grid step based on zoom
    let tickStep = 1.0;
    if (zoomLevel > 6) tickStep = 0.1;
    else if (zoomLevel > 3) tickStep = 0.5;
    else if (zoomLevel > 1.5) tickStep = 1.0;
    else if (duration > 60) tickStep = 10.0;
    else if (duration > 20) tickStep = 5.0;
    else tickStep = 2.0;

    ctx.fillStyle = '#64748b';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.textBaseline = 'middle';

    for (let t = 0; t <= duration; t += tickStep) {
      const x = timeToPixel(t);
      ctx.strokeStyle = 'rgba(100, 116, 139, 0.3)';
      ctx.beginPath();
      ctx.moveTo(x, 12);
      ctx.lineTo(x, height);
      ctx.stroke();

      const timeLabel = formatTimecode(t).slice(0, 8);
      ctx.fillText(timeLabel, x + 3, 11);
    }

    // Render Audio Peaks
    const numChannels = buffer.numberOfChannels;
    const channelHeight = (height - rulerHeight) / (numChannels > 1 ? 2 : 1);
    const rawDataL = buffer.getChannelData(0);
    const rawDataR = numChannels > 1 ? buffer.getChannelData(1) : null;
    const step = Math.ceil(buffer.length / width);

    // Waveform gradient
    const waveGradL = ctx.createLinearGradient(0, rulerHeight, 0, rulerHeight + channelHeight);
    waveGradL.addColorStop(0, '#38bdf8');
    waveGradL.addColorStop(0.5, '#06b6d4');
    waveGradL.addColorStop(1, '#0284c7');

    for (let ch = 0; ch < (numChannels > 1 ? 2 : 1); ch++) {
      const data = ch === 0 ? rawDataL : rawDataR!;
      const yCenter = rulerHeight + ch * channelHeight + channelHeight / 2;
      const amp = (channelHeight / 2) * 0.92;

      ctx.fillStyle = waveGradL;

      for (let x = 0; x < width; x++) {
        const start = Math.floor(x * step);
        const end = Math.min(buffer.length, start + step);
        let min = 1.0;
        let max = -1.0;

        for (let j = start; j < end; j += Math.max(1, Math.floor((end - start) / 10))) {
          const val = data[j];
          if (val < min) min = val;
          if (val > max) max = val;
        }

        if (max < min) {
          min = 0;
          max = 0;
        }

        const yTop = yCenter - max * amp;
        const yBottom = yCenter - min * amp;
        const barHeight = Math.max(1.5, yBottom - yTop);

        ctx.fillRect(x, yTop, 1.2, barHeight);
      }
    }

    // Draw Selection Highlight Overlay
    if (selectionEnd > selectionStart) {
      const startX = timeToPixel(selectionStart);
      const endX = timeToPixel(selectionEnd);
      const selWidth = Math.max(1, endX - startX);

      // Selection background
      ctx.fillStyle = 'rgba(6, 182, 212, 0.16)';
      ctx.fillRect(startX, rulerHeight, selWidth, height - rulerHeight);

      // Boundary lines
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(startX, rulerHeight);
      ctx.lineTo(startX, height);
      ctx.moveTo(endX, rulerHeight);
      ctx.lineTo(endX, height);
      ctx.stroke();

      // Top flags
      ctx.fillStyle = '#06b6d4';
      ctx.fillRect(startX - 1, 0, 3, rulerHeight);
      ctx.fillRect(endX - 2, 0, 3, rulerHeight);
    }

    // Hover timestamp line
    if (hoverTime !== null && hoverTime >= 0 && hoverTime <= duration) {
      const hoverX = timeToPixel(hoverTime);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hoverX, rulerHeight);
      ctx.lineTo(hoverX, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw Playhead scrubber
    if (currentTime >= 0 && currentTime <= duration) {
      const playheadX = timeToPixel(currentTime);

      // Glow line
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#06b6d4';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Playhead triangle cap
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(playheadX - 6, 0);
      ctx.lineTo(playheadX + 6, 0);
      ctx.lineTo(playheadX, 9);
      ctx.closePath();
      ctx.fill();
    }
  }, [buffer, duration, totalWaveformWidth, zoomLevel, currentTime, selectionStart, selectionEnd, hoverTime, timeToPixel]);

  // Real-time Spectrum Analyzer loop
  useEffect(() => {
    if (!showSpectrum || !analyserNode || !isPlaying) return;

    let animId: number;
    const canvas = spectrumCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const renderSpectrum = () => {
      animId = requestAnimationFrame(renderSpectrum);
      analyserNode.getByteFrequencyData(dataArray);

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const barWidth = (w / bufferLength) * 2.5;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * h;
        const hue = (i / bufferLength) * 200 + 170; // Cyan to purple
        ctx.fillStyle = `hsla(${hue}, 85%, 55%, 0.7)`;
        ctx.fillRect(x, h - barHeight, barWidth, barHeight);
        x += barWidth + 1;
        if (x > w) break;
      }
    };

    renderSpectrum();
    return () => cancelAnimationFrame(animId);
  }, [showSpectrum, analyserNode, isPlaying]);

  // Mouse drag & interaction handling
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!buffer || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left + containerRef.current.scrollLeft;
    const clickTime = pixelToTime(clickX);

    const startX = timeToPixel(selectionStart);
    const endX = timeToPixel(selectionEnd);
    const thresholdPx = 10;

    if (Math.abs(clickX - startX) < thresholdPx) {
      setIsDraggingSelection('start');
    } else if (Math.abs(clickX - endX) < thresholdPx) {
      setIsDraggingSelection('end');
    } else if (clickX > startX && clickX < endX) {
      setIsDraggingSelection('middle');
      setDragAnchor(clickTime - selectionStart);
    } else {
      // Direct seek or start new selection
      onSeek(clickTime);
      onSelectionChange(clickTime, clickTime);
      setIsDraggingSelection('end');
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || !buffer) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left + containerRef.current.scrollLeft;
    const curTime = pixelToTime(mouseX);
    setHoverTime(curTime);

    if (!isDraggingSelection) return;

    if (isDraggingSelection === 'start') {
      const newStart = Math.min(curTime, selectionEnd - 0.01);
      onSelectionChange(Math.max(0, newStart), selectionEnd);
    } else if (isDraggingSelection === 'end') {
      const newEnd = Math.max(curTime, selectionStart + 0.01);
      onSelectionChange(selectionStart, Math.min(duration, newEnd));
    } else if (isDraggingSelection === 'middle') {
      const selDuration = selectionEnd - selectionStart;
      const targetStart = Math.max(0, Math.min(duration - selDuration, curTime - dragAnchor));
      onSelectionChange(targetStart, targetStart + selDuration);
    }
  };

  const handleMouseUp = () => {
    setIsDraggingSelection(null);
  };

  const selectionDuration = Math.max(0, selectionEnd - selectionStart);

  return (
    <div className="flex flex-col rounded-xl bg-slate-900 border border-slate-800 shadow-xl overflow-hidden">
      {/* Top Waveform Header / Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-slate-900/90 border-b border-slate-800 text-xs">
        {/* Playback Timing Badges */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-mono text-sm bg-slate-950 px-3 py-1 rounded-md border border-slate-800">
            <span className="text-cyan-400 font-semibold">{formatTimecode(currentTime)}</span>
            <span className="text-slate-500">/</span>
            <span className="text-slate-400">{formatTimecode(duration)}</span>
          </div>

          {selectionDuration > 0 && (
            <div className="flex items-center gap-1 font-mono text-xs text-cyan-300 bg-cyan-950/40 border border-cyan-800/60 px-2.5 py-1 rounded-md">
              <span className="text-cyan-400 font-medium">Selected:</span>
              <span>{formatTimecode(selectionDuration)}</span>
              <span className="text-slate-500 ml-1">({formatTimecode(selectionStart)} - {formatTimecode(selectionEnd)})</span>
            </div>
          )}
        </div>

        {/* Zoom & View Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSpectrum(!showSpectrum)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors ${
              showSpectrum ? 'bg-cyan-600 text-white font-medium' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
            title="Toggle Live Frequency Spectrum Visualizer"
          >
            <Volume2 className="w-3.5 h-3.5" />
            <span>Spectrum</span>
          </button>

          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-md p-0.5">
            <button
              onClick={handleZoomOut}
              disabled={zoomLevel <= 1}
              className="p-1 text-slate-400 hover:text-slate-200 disabled:opacity-40 disabled:hover:text-slate-400"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="px-2 font-mono text-[11px] text-slate-400">
              {zoomLevel.toFixed(1)}x
            </span>
            <button
              onClick={handleZoomIn}
              disabled={zoomLevel >= 16}
              className="p-1 text-slate-400 hover:text-slate-200 disabled:opacity-40"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleZoomReset}
              className="p-1 text-slate-400 hover:text-slate-200 ml-0.5 border-l border-slate-800 pl-1.5"
              title="Fit to Window"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Interactive Waveform Viewport */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          handleMouseUp();
          setHoverTime(null);
        }}
        className="relative h-[180px] w-full overflow-x-auto overflow-y-hidden cursor-crosshair select-none bg-slate-950"
      >
        <canvas ref={canvasRef} className="block" />

        {/* Live FFT Spectrum overlay if active */}
        {showSpectrum && (
          <canvas
            ref={spectrumCanvasRef}
            width={800}
            height={60}
            className="absolute bottom-0 left-0 w-full h-[60px] pointer-events-none opacity-80"
          />
        )}
      </div>

      {/* Master Audio Transport Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-950/80 border-t border-slate-800">
        <div className="flex items-center gap-2">
          {/* Play / Pause Primary Button */}
          <button
            onClick={onTogglePlay}
            disabled={!buffer}
            className="flex items-center justify-center w-10 h-10 rounded-full bg-cyan-500 hover:bg-cyan-400 active:scale-95 text-slate-950 font-bold shadow-md shadow-cyan-500/20 transition-all disabled:opacity-50 disabled:pointer-events-none"
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          >
            {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
          </button>

          {/* Stop Button */}
          <button
            onClick={onStop}
            disabled={!buffer}
            className="p-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors disabled:opacity-50"
            title="Stop & Reset to Start"
          >
            <Square className="w-4 h-4 fill-current" />
          </button>

          {/* Loop Mode Toggle */}
          <button
            onClick={onToggleLoop}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              isLooping
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
            title="Toggle Continuous Loop Playback"
          >
            <Repeat className="w-3.5 h-3.5" />
            <span>Loop {selectionDuration > 0 ? 'Selection' : 'Track'}</span>
          </button>
        </div>

        {/* Quick Selection Helpers */}
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={() => onSelectionChange(0, duration)}
            className="px-2.5 py-1 rounded bg-slate-800/70 hover:bg-slate-700 text-slate-300 transition-colors"
          >
            Select All
          </button>
          <button
            onClick={() => onSelectionChange(0, 0)}
            className="px-2.5 py-1 rounded bg-slate-800/70 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
          >
            Clear Selection
          </button>
        </div>
      </div>
    </div>
  );
};
