import { useState } from 'react';
import { useParams } from 'react-router-dom';
import SessionLayout from '@/components/SessionLayout';
import { useEmbedded } from '@/contexts/EmbeddedContext';

type ViewMode = 'waveform' | 'timeline';

// Props for split view support
interface SoundContentProps {
  sessionId?: string;
}

export function SoundContent({ sessionId: sessionIdProp }: SoundContentProps = {}) {
  const { sessionId: sessionIdParam } = useParams<{ sessionId?: string }>();
  const _sessionId = sessionIdProp ?? sessionIdParam; // Available for future use
  const [viewMode, setViewMode] = useState<ViewMode>('timeline');

  return (
    <div className="h-full flex flex-col bg-[#1a1d2e]">
      {/* Top Toolbar */}
      <div className="flex items-center gap-2 px-4 h-14 bg-[#252836] border-b border-[#2d3142]">
        {/* View Mode Tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode('waveform')}
            className={`px-3 py-1.5 text-sm rounded ${
              viewMode === 'waveform'
                ? 'bg-primary text-primary-content'
                : 'text-base-content/70 hover:bg-base-content/10'
            }`}
          >
            Waveform Editor
          </button>
          <button
            onClick={() => setViewMode('timeline')}
            className={`px-3 py-1.5 text-sm rounded ${
              viewMode === 'timeline'
                ? 'bg-primary text-primary-content'
                : 'text-base-content/70 hover:bg-base-content/10'
            }`}
          >
            Timeline Editor
          </button>
        </div>

        {/* Toolbar Icons */}
        <div className="flex-1 flex items-center gap-1 ml-6">
          <button className="p-2 hover:bg-base-content/10 rounded" title="Cut">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
            </svg>
          </button>
          <button className="p-2 hover:bg-base-content/10 rounded" title="Copy">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
          <button className="p-2 hover:bg-base-content/10 rounded" title="Delete">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          <div className="w-px h-6 bg-base-content/20 mx-1" />
          <button className="p-2 hover:bg-base-content/10 rounded" title="Zoom In">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
            </svg>
          </button>
          <button className="p-2 hover:bg-base-content/10 rounded" title="Zoom Out">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" />
            </svg>
          </button>
        </div>

        {/* Volume Control */}
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
          </svg>
          <input type="range" className="w-24 range range-xs range-primary" min="0" max="100" defaultValue="70" />
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {viewMode === 'waveform' ? (
          <WaveformEditor />
        ) : (
          <TimelineEditor />
        )}
      </div>

      {/* Bottom Controls */}
      <div className="flex items-center justify-center gap-4 px-4 h-20 bg-[#252836] border-t border-[#2d3142]">
        {viewMode === 'timeline' && (
          <div className="flex items-center gap-2 mr-8">
            <span className="text-sm text-base-content/70">TEMPO</span>
            <span className="text-lg font-mono">120.00</span>
          </div>
        )}

        <button className="w-10 h-10 rounded-full bg-error hover:bg-error/80 flex items-center justify-center">
          <div className="w-4 h-4 rounded-full bg-white" />
        </button>
        <button className="w-10 h-10 rounded-full bg-base-content/20 hover:bg-base-content/30 flex items-center justify-center">
          <div className="w-4 h-4 bg-white" />
        </button>
        <button className="w-14 h-14 rounded-full bg-primary hover:bg-primary/80 flex items-center justify-center">
          <svg className="w-6 h-6 ml-1" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
        <button className="w-10 h-10 rounded-full bg-base-content/20 hover:bg-base-content/30 flex items-center justify-center">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
          </svg>
        </button>

        {viewMode === 'timeline' && (
          <button className="ml-8 p-2 hover:bg-base-content/10 rounded">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3 9h4V5H3v4zm0 5h4v-4H3v4zm5 0h4v-4H8v4zm5 0h4v-4h-4v4zM8 9h4V5H8v4zm5-4v4h4V5h-4zm5 9h4v-4h-4v4zM3 19h4v-4H3v4zm5 0h4v-4H8v4zm5 0h4v-4h-4v4zm5 0h4v-4h-4v4zm0-14v4h4V5h-4z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

function WaveformEditor() {
  return (
    <>
      {/* Main Waveform Area */}
      <div className="flex-1 flex flex-col p-8 overflow-hidden">
        {/* Waveform Display */}
        <div className="flex-1 bg-[#0f1117] rounded-lg border border-[#2d3142] relative overflow-hidden">
          {/* Grid Lines */}
          <svg className="absolute inset-0 w-full h-full opacity-20">
            {Array.from({ length: 20 }).map((_, i) => (
              <line
                key={`v-${i}`}
                x1={`${(i * 5)}%`}
                y1="0"
                x2={`${(i * 5)}%`}
                y2="100%"
                stroke="currentColor"
                strokeWidth="1"
              />
            ))}
            {Array.from({ length: 10 }).map((_, i) => (
              <line
                key={`h-${i}`}
                x1="0"
                y1={`${(i * 10)}%`}
                x2="100%"
                y2={`${(i * 10)}%`}
                stroke="currentColor"
                strokeWidth="1"
              />
            ))}
          </svg>

          {/* Playhead */}
          <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-error" style={{ left: '15%' }} />

          {/* Waveform */}
          <svg className="absolute inset-0 w-full h-full">
            <path
              d={generateWaveformPath()}
              fill="none"
              stroke="#6366f1"
              strokeWidth="2"
            />
          </svg>
        </div>
      </div>

      {/* Right Properties Panel */}
      <div className="w-80 bg-[#252836] border-l border-[#2d3142] p-6 overflow-y-auto">
        <h3 className="text-sm font-bold text-base-content/50 mb-4">PROPERTIES</h3>

        {/* Track Info */}
        <div className="mb-6">
          <label className="block text-sm mb-2">Track: <span className="font-semibold">Master</span></label>
        </div>

        {/* Volume */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm">Volume</label>
            <span className="text-sm text-base-content/70">-3.0 dB</span>
          </div>
          <input type="range" className="w-full range range-sm range-primary" min="-60" max="6" defaultValue="-3" />
        </div>

        {/* Pan */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm">Pan</label>
            <span className="text-sm text-base-content/70">C</span>
          </div>
          <input type="range" className="w-full range range-sm range-primary" min="-100" max="100" defaultValue="0" />
        </div>

        {/* Effects */}
        <div>
          <h4 className="text-sm font-semibold mb-4">Effects</h4>

          {/* Reverb */}
          <div className="mb-4 p-3 bg-[#1a1d2e] rounded-lg border border-primary/30">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium">Reverb</span>
              <input type="checkbox" className="toggle toggle-sm toggle-primary" defaultChecked />
            </div>
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-base-content/70">Mix</label>
                  <span className="text-xs text-base-content/70">35%</span>
                </div>
                <input type="range" className="w-full range range-xs range-primary" min="0" max="100" defaultValue="35" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-base-content/70">Decay</label>
                  <span className="text-xs text-base-content/70">2.1s</span>
                </div>
                <input type="range" className="w-full range range-xs range-primary" min="0" max="10" step="0.1" defaultValue="2.1" />
              </div>
            </div>
          </div>

          {/* Compressor */}
          <div className="mb-4 p-3 bg-[#1a1d2e] rounded-lg border border-base-content/20">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-base-content/50">Compressor</span>
              <input type="checkbox" className="toggle toggle-sm toggle-primary" />
            </div>
          </div>

          {/* Add Effect Button */}
          <button className="w-full py-2 border-2 border-dashed border-base-content/30 rounded-lg text-sm text-base-content/50 hover:border-primary hover:text-primary transition-colors">
            + Add Effect
          </button>
        </div>
      </div>
    </>
  );
}

function TimelineEditor() {
  const tracks = [
    { name: 'Drums', color: '#c4a43e', solo: true, mute: false },
    { name: 'Bass', color: '#4a7ba7', solo: true, mute: false },
    { name: 'Melody', color: '#a855f7', solo: true, mute: true, clips: [{ start: 20, width: 15 }, { start: 50, width: 8 }] },
  ];

  return (
    <>
      {/* Left Library Panel */}
      <div className="w-64 bg-[#252836] border-r border-[#2d3142] p-4 overflow-y-auto">
        <h3 className="text-sm font-bold text-base-content/50 mb-4">LIBRARY</h3>

        {/* Instruments */}
        <div className="mb-6">
          <h4 className="text-xs font-semibold text-base-content/70 mb-2">INSTRUMENTS</h4>
          <div className="space-y-1">
            <button className="w-full text-left px-3 py-2 text-sm hover:bg-base-content/10 rounded">
              Acoustic Piano
            </button>
            <button className="w-full text-left px-3 py-2 text-sm text-primary hover:bg-primary/10 rounded">
              Synth Bass
            </button>
            <button className="w-full text-left px-3 py-2 text-sm hover:bg-base-content/10 rounded">
              Drum Kit 808
            </button>
          </div>
        </div>

        {/* Samples */}
        <div className="mb-6">
          <h4 className="text-xs font-semibold text-base-content/70 mb-2">SAMPLES</h4>
          <div className="space-y-1">
            <button className="w-full text-left px-3 py-2 text-sm hover:bg-base-content/10 rounded">
              Kick_01.wav
            </button>
            <button className="w-full text-left px-3 py-2 text-sm hover:bg-base-content/10 rounded">
              Snare_sharp.wav
            </button>
            <button className="w-full text-left px-3 py-2 text-sm hover:bg-base-content/10 rounded">
              Hihat_closed.wav
            </button>
          </div>
        </div>

        {/* Presets */}
        <div>
          <h4 className="text-xs font-semibold text-base-content/70 mb-2">PRESETS</h4>
          <div className="space-y-1">
            <button className="w-full text-left px-3 py-2 text-sm hover:bg-base-content/10 rounded">
              Ambient Pad
            </button>
            <button className="w-full text-left px-3 py-2 text-sm hover:bg-base-content/10 rounded">
              Wobble Lead
            </button>
          </div>
        </div>
      </div>

      {/* Main Timeline Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Track Controls and Timeline */}
        <div className="flex-1 flex flex-col p-4 overflow-y-auto">
          {/* Tracks */}
          <div className="space-y-2 mb-4">
            {tracks.map((track, idx) => (
              <div key={idx} className="flex items-center gap-2">
                {/* Track Header */}
                <div className={`w-64 px-3 py-2 rounded border ${track.name === 'Melody' ? 'border-primary/50 bg-primary/5' : 'border-base-content/20 bg-[#252836]'}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{track.name}</span>
                    <div className="flex gap-1">
                      <button className={`w-6 h-6 rounded text-xs font-bold ${track.solo ? 'bg-warning text-warning-content' : 'bg-base-content/20 text-base-content/50'}`}>
                        S
                      </button>
                      <button className={`w-6 h-6 rounded text-xs font-bold ${track.mute ? 'bg-error text-error-content' : 'bg-base-content/20 text-base-content/50'}`}>
                        M
                      </button>
                    </div>
                  </div>
                  <input type="range" className="w-full range range-xs range-primary mt-2" min="0" max="100" defaultValue="50" />
                </div>

                {/* Timeline Grid */}
                <div className="flex-1 h-24 bg-[#0f1117] rounded border border-[#2d3142] relative overflow-hidden">
                  {/* Grid */}
                  <div className="absolute inset-0 flex">
                    {Array.from({ length: 16 }).map((_, i) => (
                      <div key={i} className="flex-1 border-r border-base-content/10" />
                    ))}
                  </div>

                  {/* Clips */}
                  {track.clips?.map((clip, clipIdx) => (
                    <div
                      key={clipIdx}
                      className="absolute top-2 bottom-2 rounded"
                      style={{
                        left: `${clip.start}%`,
                        width: `${clip.width}%`,
                        backgroundColor: track.color,
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Add Track Button */}
          <button className="w-64 py-2 border-2 border-dashed border-base-content/30 rounded-lg text-sm text-base-content/50 hover:border-primary hover:text-primary transition-colors mb-6">
            + Add Track
          </button>

          {/* Piano Roll */}
          <div className="mt-4">
            <h4 className="text-sm font-semibold mb-2">Piano Roll: Melody</h4>
            <div className="bg-[#252836] rounded-lg border border-[#2d3142] p-4">
              {/* Piano Roll Grid */}
              <div className="flex">
                {/* Note Labels */}
                <div className="w-12 space-y-px">
                  {['C#5', 'C5', 'B4', 'A#4', 'A4', 'G#4', 'G4', 'F#4', 'F4'].map((note) => (
                    <div key={note} className="h-6 text-xs text-base-content/50 flex items-center justify-end pr-2">
                      {note}
                    </div>
                  ))}
                </div>

                {/* Grid */}
                <div className="flex-1 relative bg-[#0f1117] rounded">
                  {/* Grid Lines */}
                  <div className="absolute inset-0">
                    {Array.from({ length: 9 }).map((_, i) => (
                      <div key={`row-${i}`} className="h-6 border-b border-base-content/10" />
                    ))}
                    <div className="absolute inset-0 flex">
                      {Array.from({ length: 16 }).map((_, i) => (
                        <div key={`col-${i}`} className="flex-1 border-r border-base-content/10" />
                      ))}
                    </div>
                  </div>

                  {/* Notes */}
                  <div className="absolute" style={{ top: '2.25rem', left: '18.75%', width: '12.5%', height: '1.25rem', backgroundColor: '#a855f7', borderRadius: '2px' }} />
                  <div className="absolute" style={{ top: '1.5rem', left: '31.25%', width: '6.25%', height: '1.25rem', backgroundColor: '#a855f7', borderRadius: '2px' }} />
                  <div className="absolute" style={{ top: '4.5rem', left: '43.75%', width: '6.25%', height: '1.25rem', backgroundColor: '#a855f7', borderRadius: '2px' }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// Generate a simple waveform path
function generateWaveformPath(): string {
  const points: string[] = [];
  const width = 1000;
  const height = 200;
  const centerY = height / 2;

  for (let x = 0; x < width; x += 2) {
    const frequency = 0.05;
    const amplitude = Math.sin(x * 0.01) * 40 + 60;
    const y = centerY + Math.sin(x * frequency) * amplitude;

    if (x === 0) {
      points.push(`M ${x} ${y}`);
    } else {
      points.push(`L ${x} ${y}`);
    }
  }

  return points.join(' ');
}

interface SoundProps {
  isEmbedded?: boolean;
}

export default function Sound({ isEmbedded: isEmbeddedProp = false }: SoundProps) {
  // Check if we're embedded via context (from split view) or prop
  const { isEmbedded: isEmbeddedContext } = useEmbedded();
  const isEmbedded = isEmbeddedProp || isEmbeddedContext;

  // Wrap content conditionally - when embedded, skip SessionLayout wrapper
  const Wrapper = isEmbedded ?
    ({ children }: { children: React.ReactNode }) => <div className="h-full flex flex-col overflow-hidden bg-base-200">{children}</div> :
    ({ children }: { children: React.ReactNode }) => (
      <SessionLayout>
        {children}
      </SessionLayout>
    );

  return (
    <Wrapper>
      <SoundContent />
    </Wrapper>
  );
}
