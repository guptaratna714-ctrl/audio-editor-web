import React, { useState } from 'react';
import {
  Scissors,
  Volume2,
  Gauge,
  Music,
  Sliders,
  RotateCcw,
  Sparkles,
  Zap,
  CheckCircle2,
  Undo2,
  Redo2,
  Play
} from 'lucide-react';
import { EQBand, formatTimecode } from '../utils/audioEngine';

export type ToolTab = 'trim' | 'volume' | 'speed_pitch' | 'equalizer' | 'reverse';

interface StudioToolsProps {
  activeTab: ToolTab;
  onTabChange: (tab: ToolTab) => void;
  selectionStart: number;
  selectionEnd: number;
  duration: number;
  onApplyTrim: (mode: 'keep' | 'cut', fadeIn: number, fadeOut: number) => void;
  onApplyGain: (factor: number, applyToSelectionOnly: boolean) => void;
  onNormalize: () => void;
  onApplySpeedPitch: (speed: number, semitones: number, cents: number, preservePitch: boolean) => Promise<void>;
  onApplyEqualizer: (bands: EQBand[]) => Promise<void>;
  onApplyReverse: (selectionOnly: boolean, pingPong?: boolean) => void;
  onUpdateRealtimeEQ?: (bands: EQBand[]) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  isProcessing: boolean;
}

export const StudioTools: React.FC<StudioToolsProps> = ({
  activeTab,
  onTabChange,
  selectionStart,
  selectionEnd,
  duration,
  onApplyTrim,
  onApplyGain,
  onNormalize,
  onApplySpeedPitch,
  onApplyEqualizer,
  onApplyReverse,
  onUpdateRealtimeEQ,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  isProcessing,
}) => {
  // Trim state
  const [fadeInSec, setFadeInSec] = useState<number>(0.05);
  const [fadeOutSec, setFadeOutSec] = useState<number>(0.05);

  // Volume state
  const [gainDb, setGainDb] = useState<number>(0);
  const [applyGainToSelection, setApplyGainToSelection] = useState<boolean>(false);

  // Speed & Pitch state
  const [speed, setSpeed] = useState<number>(1.0);
  const [semitones, setSemitones] = useState<number>(0);
  const [cents, setCents] = useState<number>(0);
  const [preservePitch, setPreservePitch] = useState<boolean>(true);

  // Equalizer state (7-band EQ)
  const defaultEQBands: EQBand[] = [
    { freq: 60, gain: 0, q: 1.2 },
    { freq: 170, gain: 0, q: 1.2 },
    { freq: 400, gain: 0, q: 1.2 },
    { freq: 1000, gain: 0, q: 1.2 },
    { freq: 3000, gain: 0, q: 1.2 },
    { freq: 8000, gain: 0, q: 1.2 },
    { freq: 14000, gain: 0, q: 1.2 },
  ];
  const [eqBands, setEqBands] = useState<EQBand[]>(defaultEQBands);
  const [activePreset, setActivePreset] = useState<string>('Flat');

  // EQ Presets dictionary
  const eqPresets: Record<string, number[]> = {
    Flat: [0, 0, 0, 0, 0, 0, 0],
    'Bass Boost': [6, 4.5, 2, 0, 0, 0, 0],
    'Bass Reducer': [-6, -4, -2, 0, 0, 0, 0],
    'Vocal Clarity': [-3, -1, 1, 3.5, 4, 3, 1],
    'Acoustic Warmth': [3, 2, 0, 1, 2, 3, 2],
    'Podcast Presence': [-4, 0, 2, 4, 3.5, 2, -1],
    'Electronic Punch': [7, 4, -2, 1, 3, 4.5, 5],
    'Rock / Metal': [4.5, 3, -1, 1, 3.5, 4, 3],
    'Treble Boost': [0, 0, 0, 1, 3, 5, 7],
  };

  const handleSelectEQPreset = (presetName: string) => {
    setActivePreset(presetName);
    const gains = eqPresets[presetName] || [0, 0, 0, 0, 0, 0, 0];
    const newBands = eqBands.map((b, i) => ({ ...b, gain: gains[i] || 0 }));
    setEqBands(newBands);
    onUpdateRealtimeEQ?.(newBands);
  };

  const handleBandGainChange = (index: number, newGain: number) => {
    setActivePreset('Custom');
    const newBands = [...eqBands];
    newBands[index] = { ...newBands[index], gain: newGain };
    setEqBands(newBands);
    onUpdateRealtimeEQ?.(newBands);
  };

  const hasSelection = selectionEnd > selectionStart;

  return (
    <div className="flex flex-col rounded-xl bg-slate-900 border border-slate-800 shadow-xl overflow-hidden">
      {/* Top Navigation & History Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-slate-950/90 border-b border-slate-800">
        {/* Tool Selector Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto p-1 bg-slate-900 rounded-lg border border-slate-800">
          <button
            onClick={() => onTabChange('trim')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${
              activeTab === 'trim'
                ? 'bg-cyan-500 text-slate-950 font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Scissors className="w-3.5 h-3.5" />
            <span>Trim & Cut</span>
          </button>

          <button
            onClick={() => onTabChange('volume')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${
              activeTab === 'volume'
                ? 'bg-cyan-500 text-slate-950 font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Volume2 className="w-3.5 h-3.5" />
            <span>Volume</span>
          </button>

          <button
            onClick={() => onTabChange('speed_pitch')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${
              activeTab === 'speed_pitch'
                ? 'bg-cyan-500 text-slate-950 font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Gauge className="w-3.5 h-3.5" />
            <span>Speed & Pitch</span>
          </button>

          <button
            onClick={() => onTabChange('equalizer')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${
              activeTab === 'equalizer'
                ? 'bg-cyan-500 text-slate-950 font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Equalizer</span>
          </button>

          <button
            onClick={() => onTabChange('reverse')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${
              activeTab === 'reverse'
                ? 'bg-cyan-500 text-slate-950 font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reverse</span>
          </button>
        </div>

        {/* Undo / Redo Actions */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={onUndo}
            disabled={!canUndo || isProcessing}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white disabled:opacity-40 disabled:hover:bg-slate-800 transition-colors"
            title="Undo Last Action (Ctrl+Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
            <span>Undo</span>
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo || isProcessing}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white disabled:opacity-40 disabled:hover:bg-slate-800 transition-colors"
            title="Redo (Ctrl+Y)"
          >
            <Redo2 className="w-3.5 h-3.5" />
            <span>Redo</span>
          </button>
        </div>
      </div>

      {/* Tool Content Panels */}
      <div className="p-5">
        {/* TAB 1: TRIM AUDIO */}
        {activeTab === 'trim' && (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">Audio Trimming & Splicing</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Drag the markers on the waveform or use the timecodes below to isolate or remove audio sections.
                </p>
              </div>
            </div>

            {/* Timecode Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 bg-slate-950 rounded-lg border border-slate-800">
              <div>
                <span className="block text-[11px] font-medium text-slate-400 mb-1">Start Point</span>
                <span className="block font-mono text-sm text-cyan-400 font-medium">
                  {formatTimecode(selectionStart)}
                </span>
              </div>
              <div>
                <span className="block text-[11px] font-medium text-slate-400 mb-1">End Point</span>
                <span className="block font-mono text-sm text-cyan-400 font-medium">
                  {formatTimecode(selectionEnd > 0 ? selectionEnd : duration)}
                </span>
              </div>
              <div>
                <span className="block text-[11px] font-medium text-slate-400 mb-1">Selection Length</span>
                <span className="block font-mono text-sm text-slate-200">
                  {formatTimecode(Math.max(0, (selectionEnd > 0 ? selectionEnd : duration) - selectionStart))}
                </span>
              </div>
            </div>

            {/* Edge Fades Configuration */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="flex items-center justify-between text-xs text-slate-300 mb-1.5">
                  <span>Fade In Edge</span>
                  <span className="font-mono text-cyan-400">{fadeInSec.toFixed(2)}s</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="1.5"
                  step="0.01"
                  value={fadeInSec}
                  onChange={(e) => setFadeInSec(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>

              <div>
                <label className="flex items-center justify-between text-xs text-slate-300 mb-1.5">
                  <span>Fade Out Edge</span>
                  <span className="font-mono text-cyan-400">{fadeOutSec.toFixed(2)}s</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="1.5"
                  step="0.01"
                  value={fadeOutSec}
                  onChange={(e) => setFadeOutSec(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                onClick={() => onApplyTrim('keep', fadeInSec, fadeOutSec)}
                disabled={!hasSelection || isProcessing}
                className="flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors disabled:opacity-40 shadow-sm"
              >
                <Scissors className="w-3.5 h-3.5" />
                <span>Keep Selection (Crop)</span>
              </button>

              <button
                onClick={() => onApplyTrim('cut', fadeInSec, fadeOutSec)}
                disabled={!hasSelection || isProcessing}
                className="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-slate-800 hover:bg-rose-950/50 hover:text-rose-300 hover:border-rose-700/50 text-slate-300 border border-slate-700 transition-colors disabled:opacity-40"
              >
                <span>Delete Selection (Splice)</span>
              </button>

              {!hasSelection && (
                <span className="text-xs text-amber-400/80">
                  Select a region on the waveform above to crop or delete.
                </span>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: CHANGE VOLUME */}
        {activeTab === 'volume' && (
          <div className="space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">Volume & Amplification</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Adjust amplitude, normalize loudness to peak 0 dBFS without clipping, or mute specific sections.
              </p>
            </div>

            {/* dB Slider and readouts */}
            <div className="p-4 bg-slate-950 rounded-lg border border-slate-800 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300 font-medium">Gain Offset</span>
                <div className="flex items-center gap-2 font-mono">
                  <span className={`text-sm font-bold ${gainDb > 0 ? 'text-amber-400' : gainDb < 0 ? 'text-cyan-400' : 'text-slate-300'}`}>
                    {gainDb > 0 ? `+${gainDb.toFixed(1)}` : gainDb.toFixed(1)} dB
                  </span>
                  <span className="text-slate-500">
                    ({Math.round(Math.pow(10, gainDb / 20) * 100)}%)
                  </span>
                </div>
              </div>

              <input
                type="range"
                min="-24"
                max="18"
                step="0.5"
                value={gainDb}
                onChange={(e) => setGainDb(parseFloat(e.target.value))}
                className="w-full"
              />

              {/* Quick Preset Gains */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {[-12, -6, -3, 0, 3, 6, 12].map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setGainDb(preset)}
                    className={`px-2 py-1 text-[11px] font-mono rounded border transition-colors ${
                      gainDb === preset
                        ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    {preset > 0 ? `+${preset}dB` : preset === 0 ? '0dB' : `${preset}dB`}
                  </button>
                ))}
              </div>
            </div>

            {/* Scope Toggle & Apply */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={applyGainToSelection}
                  onChange={(e) => setApplyGainToSelection(e.target.checked)}
                  disabled={!hasSelection}
                  className="rounded border-slate-700 text-cyan-500 focus:ring-0"
                />
                <span>Apply gain to current selection only</span>
              </label>

              <div className="flex items-center gap-3">
                <button
                  onClick={onNormalize}
                  disabled={isProcessing}
                  className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
                  title="Scale waveform peaks up to -0.1 dBFS without distortion"
                >
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Auto Normalize Peak</span>
                </button>

                <button
                  onClick={() => {
                    const factor = Math.pow(10, gainDb / 20);
                    onApplyGain(factor, applyGainToSelection && hasSelection);
                    setGainDb(0);
                  }}
                  disabled={Math.abs(gainDb) < 0.1 || isProcessing}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors disabled:opacity-40"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Apply Gain</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: SPEED & PITCH */}
        {activeTab === 'speed_pitch' && (
          <div className="space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">Playback Speed & Pitch Shifting</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Speed up or slow down tracks with Synchronous Overlap-Add (SOLA) time-stretching, and transpose musical key in semitones or cents.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Speed Controls */}
              <div className="p-4 bg-slate-950 rounded-lg border border-slate-800 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-medium">Tempo / Speed</span>
                  <span className="font-mono text-sm font-bold text-cyan-400">{speed.toFixed(2)}x</span>
                </div>

                <input
                  type="range"
                  min="0.25"
                  max="2.5"
                  step="0.05"
                  value={speed}
                  onChange={(e) => setSpeed(parseFloat(e.target.value))}
                  className="w-full"
                />

                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((s) => (
                    <button
                      key={s}
                      onClick={() => setSpeed(s)}
                      className={`px-2 py-1 text-[11px] font-mono rounded border transition-colors ${
                        Math.abs(speed - s) < 0.01
                          ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50'
                          : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                      }`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>

                <div className="pt-2">
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={preservePitch}
                      onChange={(e) => setPreservePitch(e.target.checked)}
                      className="rounded border-slate-700 text-cyan-500 focus:ring-0"
                    />
                    <span>Preserve musical pitch when changing speed (SOLA)</span>
                  </label>
                </div>
              </div>

              {/* Pitch Shifter Controls */}
              <div className="p-4 bg-slate-950 rounded-lg border border-slate-800 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-medium">Pitch Transpose</span>
                  <span className="font-mono text-sm font-bold text-cyan-400">
                    {semitones > 0 ? `+${semitones}` : semitones} st ({cents > 0 ? `+${cents}` : cents} ct)
                  </span>
                </div>

                <div>
                  <span className="block text-[11px] text-slate-400 mb-1">Semitones (-12 to +12)</span>
                  <input
                    type="range"
                    min="-12"
                    max="12"
                    step="1"
                    value={semitones}
                    onChange={(e) => setSemitones(parseInt(e.target.value, 10))}
                    className="w-full"
                  />
                </div>

                <div>
                  <span className="block text-[11px] text-slate-400 mb-1">Fine-tune Cents (-100 to +100)</span>
                  <input
                    type="range"
                    min="-100"
                    max="100"
                    step="5"
                    value={cents}
                    onChange={(e) => setCents(parseInt(e.target.value, 10))}
                    className="w-full"
                  />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => {
                      setSemitones(0);
                      setCents(0);
                    }}
                    className="text-[11px] text-slate-400 hover:text-slate-200 underline"
                  >
                    Reset Pitch
                  </button>
                </div>
              </div>
            </div>

            {/* Apply Speed/Pitch button */}
            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                onClick={() => {
                  setSpeed(1.0);
                  setSemitones(0);
                  setCents(0);
                }}
                className="px-3 py-2 text-xs text-slate-400 hover:text-slate-200 transition-colors"
              >
                Reset All
              </button>

              <button
                onClick={async () => {
                  await onApplySpeedPitch(speed, semitones, cents, preservePitch);
                  setSpeed(1.0);
                  setSemitones(0);
                  setCents(0);
                }}
                disabled={
                  (Math.abs(speed - 1.0) < 0.01 && semitones === 0 && cents === 0) ||
                  isProcessing
                }
                className="flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors disabled:opacity-40"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>{isProcessing ? 'Processing DSP...' : 'Apply Speed & Pitch'}</span>
              </button>
            </div>
          </div>
        )}

        {/* TAB 4: EQUALIZER */}
        {activeTab === 'equalizer' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">7-Band Graphic Equalizer</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Shape frequency balance across low bass, mids, and airy highs with studio biquad filters.
                </p>
              </div>

              {/* Preset Selector */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Preset:</span>
                <select
                  value={activePreset}
                  onChange={(e) => handleSelectEQPreset(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-md px-2.5 py-1 text-xs text-slate-200 outline-none focus:border-cyan-500"
                >
                  {Object.keys(eqPresets).map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                  <option value="Custom">Custom</option>
                </select>
              </div>
            </div>

            {/* EQ Sliders Container */}
            <div className="p-4 bg-slate-950 rounded-lg border border-slate-800">
              <div className="grid grid-cols-7 gap-2 sm:gap-4 items-end justify-items-center py-2">
                {eqBands.map((band, idx) => (
                  <div key={band.freq} className="flex flex-col items-center gap-2">
                    <span className="font-mono text-[11px] text-cyan-400 font-semibold">
                      {band.gain > 0 ? `+${band.gain.toFixed(1)}` : band.gain.toFixed(1)}
                    </span>

                    <input
                      type="range"
                      min="-15"
                      max="15"
                      step="0.5"
                      value={band.gain}
                      onChange={(e) => handleBandGainChange(idx, parseFloat(e.target.value))}
                      className="vertical-slider"
                      title={`${band.freq}Hz: ${band.gain}dB`}
                    />

                    <div className="text-center">
                      <span className="block font-mono text-[11px] text-slate-200 font-medium">
                        {band.freq >= 1000 ? `${band.freq / 1000}k` : band.freq}
                      </span>
                      <span className="block text-[9px] text-slate-500 uppercase">Hz</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* EQ Actions */}
            <div className="flex items-center justify-between gap-3 pt-1">
              <button
                onClick={() => handleSelectEQPreset('Flat')}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
              >
                Reset Flat (0 dB)
              </button>

              <button
                onClick={async () => {
                  await onApplyEqualizer(eqBands);
                }}
                disabled={isProcessing}
                className="flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors disabled:opacity-40"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{isProcessing ? 'Rendering EQ...' : 'Apply EQ to Track'}</span>
              </button>
            </div>
          </div>
        )}

        {/* TAB 5: REVERSE AUDIO */}
        {activeTab === 'reverse' && (
          <div className="space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">Reverse Audio</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Play backwards for creative backward reverb swells, reverse cymbals, or surreal sound design effects.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-4 bg-slate-950 rounded-lg border border-slate-800 space-y-2 flex flex-col justify-between">
                <div>
                  <h4 className="text-xs font-medium text-slate-200">Reverse Whole Track</h4>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Reverses the entire audio file from the last sample to the first.
                  </p>
                </div>
                <button
                  onClick={() => onApplyReverse(false)}
                  disabled={isProcessing}
                  className="w-full py-2 text-xs font-semibold rounded-md bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors"
                >
                  Reverse Entire Audio
                </button>
              </div>

              <div className="p-4 bg-slate-950 rounded-lg border border-slate-800 space-y-2 flex flex-col justify-between">
                <div>
                  <h4 className="text-xs font-medium text-slate-200">Reverse Selection</h4>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Only reverses the time range currently highlighted on the waveform.
                  </p>
                </div>
                <button
                  onClick={() => onApplyReverse(true)}
                  disabled={!hasSelection || isProcessing}
                  className="w-full py-2 text-xs font-semibold rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors disabled:opacity-40"
                >
                  Reverse Selection
                </button>
              </div>

              <div className="p-4 bg-slate-950 rounded-lg border border-slate-800 space-y-2 flex flex-col justify-between">
                <div>
                  <h4 className="text-xs font-medium text-slate-200">Ping-Pong Loop</h4>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Appends a reversed clone to the end, creating a seamless forward-backward loop.
                  </p>
                </div>
                <button
                  onClick={() => onApplyReverse(false, true)}
                  disabled={isProcessing}
                  className="w-full py-2 text-xs font-semibold rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
                >
                  Create Ping-Pong
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
