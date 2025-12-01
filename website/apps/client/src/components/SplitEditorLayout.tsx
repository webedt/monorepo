import { useState, useCallback, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSplitViewStore } from '@/lib/store';
import { EmbeddedProvider } from '@/contexts/EmbeddedContext';

// Lazy load editor components to avoid circular dependencies
import Code from '@/pages/Code';
import Images from '@/pages/Images';
import Sound from '@/pages/Sound';
import SceneEditor from '@/pages/SceneEditor';
import Preview from '@/pages/Preview';
import Chat from '@/pages/Chat';

// Map of page names to components
const PAGE_COMPONENTS: Record<string, React.ComponentType<{ isEmbedded?: boolean }>> = {
  code: Code,
  images: Images,
  sound: Sound,
  'scene-editor': SceneEditor,
  preview: Preview,
  chat: Chat,
};

// Valid page names for split view
export const SPLIT_VIEW_PAGES = ['code', 'images', 'sound', 'scene-editor', 'preview', 'chat'] as const;
export type SplitViewPage = typeof SPLIT_VIEW_PAGES[number];

// Parse split route pattern (e.g., "code+preview" -> ['code', 'preview'])
export function parseSplitRoute(splitParam: string): [SplitViewPage, SplitViewPage] | null {
  const parts = splitParam.split('+');
  if (parts.length !== 2) return null;

  const [left, right] = parts;
  if (!SPLIT_VIEW_PAGES.includes(left as SplitViewPage) ||
      !SPLIT_VIEW_PAGES.includes(right as SplitViewPage)) {
    return null;
  }

  return [left as SplitViewPage, right as SplitViewPage];
}

// Build split route URL
export function buildSplitRoute(sessionId: string | undefined, left: SplitViewPage, right: SplitViewPage): string {
  if (sessionId) {
    return `/session/${sessionId}/split/${left}+${right}`;
  }
  return `/split/${left}+${right}`;
}

interface SplitEditorLayoutProps {
  leftPage: SplitViewPage;
  rightPage: SplitViewPage;
}

export default function SplitEditorLayout({ leftPage, rightPage }: SplitEditorLayoutProps) {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { splitPosition, splitOrientation, setSplitPosition } = useSplitViewStore();

  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Get components for each side
  const LeftComponent = PAGE_COMPONENTS[leftPage];
  const RightComponent = PAGE_COMPONENTS[rightPage];

  // Handle drag to resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !containerRef.current) return;

    const container = containerRef.current;
    const rect = container.getBoundingClientRect();

    let newPosition: number;
    if (splitOrientation === 'horizontal') {
      newPosition = ((e.clientX - rect.left) / rect.width) * 100;
    } else {
      newPosition = ((e.clientY - rect.top) / rect.height) * 100;
    }

    // Clamp between 20% and 80%
    newPosition = Math.max(20, Math.min(80, newPosition));
    setSplitPosition(newPosition);
  }, [isDragging, splitOrientation, setSplitPosition]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Add/remove global mouse listeners for drag
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = splitOrientation === 'horizontal' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, handleMouseMove, handleMouseUp, splitOrientation]);

  // Navigate to single page (exit split view)
  const exitToPage = useCallback((page: SplitViewPage) => {
    if (sessionId) {
      navigate(`/session/${sessionId}/${page}`);
    } else {
      navigate(`/${page}`);
    }
  }, [sessionId, navigate]);

  // Swap left and right panels
  const swapPanels = useCallback(() => {
    navigate(buildSplitRoute(sessionId, rightPage, leftPage));
  }, [sessionId, leftPage, rightPage, navigate]);

  const isHorizontal = splitOrientation === 'horizontal';

  return (
    <div
      ref={containerRef}
      className={`flex-1 flex ${isHorizontal ? 'flex-row' : 'flex-col'} min-h-0 overflow-hidden`}
    >
      {/* Left/Top Panel */}
      <div
        className="overflow-hidden flex flex-col min-w-0 min-h-0"
        style={{
          [isHorizontal ? 'width' : 'height']: `${splitPosition}%`,
          flexShrink: 0,
        }}
      >
        {/* Panel header */}
        <div className="flex items-center justify-between px-2 py-1 bg-base-200 border-b border-base-300 text-xs">
          <span className="font-medium capitalize">{leftPage}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={swapPanels}
              className="btn btn-ghost btn-xs"
              title="Swap panels"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </button>
            <button
              onClick={() => exitToPage(leftPage)}
              className="btn btn-ghost btn-xs"
              title="Maximize this panel"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
            </button>
          </div>
        </div>
        {/* Panel content */}
        <div className="flex-1 overflow-hidden">
          <EmbeddedProvider isEmbedded>
            <LeftComponent isEmbedded />
          </EmbeddedProvider>
        </div>
      </div>

      {/* Resizer */}
      <div
        className={`
          ${isHorizontal ? 'w-1 cursor-col-resize hover:w-1.5' : 'h-1 cursor-row-resize hover:h-1.5'}
          bg-base-300 hover:bg-primary/50 transition-all flex-shrink-0
          ${isDragging ? 'bg-primary' : ''}
        `}
        onMouseDown={handleMouseDown}
      />

      {/* Right/Bottom Panel */}
      <div
        className="overflow-hidden flex flex-col min-w-0 min-h-0 flex-1"
      >
        {/* Panel header */}
        <div className="flex items-center justify-between px-2 py-1 bg-base-200 border-b border-base-300 text-xs">
          <span className="font-medium capitalize">{rightPage}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={swapPanels}
              className="btn btn-ghost btn-xs"
              title="Swap panels"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </button>
            <button
              onClick={() => exitToPage(rightPage)}
              className="btn btn-ghost btn-xs"
              title="Maximize this panel"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
            </button>
          </div>
        </div>
        {/* Panel content */}
        <div className="flex-1 overflow-hidden">
          <EmbeddedProvider isEmbedded>
            <RightComponent isEmbedded />
          </EmbeddedProvider>
        </div>
      </div>
    </div>
  );
}
