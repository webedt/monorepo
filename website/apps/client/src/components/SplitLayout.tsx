import { useState, useCallback, useRef, useEffect } from 'react';

// Import content components from pages
import Code from '@/pages/Code';
import Chat from '@/pages/Chat';
import { ImagesContent } from '@/pages/Images';
import { SoundContent } from '@/pages/Sound';
import { PreviewPane } from '@/pages/Preview';
import { SceneEditorContent } from '@/pages/SceneEditor';

export type SplitPageName = 'chat' | 'code' | 'images' | 'sound' | 'scene-editor' | 'preview';
export type SplitOrientation = 'horizontal' | 'vertical';

interface SplitLayoutProps {
  leftPage: SplitPageName;
  rightPage: SplitPageName;
  sessionId: string;
  initialRatio?: number; // 0.5 = 50/50
  orientation?: SplitOrientation;
  onRatioChange?: (ratio: number) => void;
}

// Map page names to their content components
function renderPane(pageName: SplitPageName, sessionId: string) {
  switch (pageName) {
    case 'chat':
      return <Chat sessionId={sessionId} embedded />;
    case 'code':
      return <Code sessionId={sessionId} embedded />;
    case 'images':
      return <ImagesContent sessionId={sessionId} />;
    case 'sound':
      return <SoundContent sessionId={sessionId} />;
    case 'scene-editor':
      return <SceneEditorContent sessionId={sessionId} />;
    case 'preview':
      return <PreviewPane sessionId={sessionId} />;
    default:
      return <div className="h-full flex items-center justify-center text-base-content/50">Unknown page: {pageName}</div>;
  }
}

// Get display name for a page
export function getPageDisplayName(pageName: SplitPageName): string {
  const names: Record<SplitPageName, string> = {
    chat: 'Chat',
    code: 'Code',
    images: 'Images',
    sound: 'Sound',
    'scene-editor': 'Scene Editor',
    preview: 'Preview',
  };
  return names[pageName] || pageName;
}

export default function SplitLayout({
  leftPage,
  rightPage,
  sessionId,
  initialRatio = 0.5,
  orientation = 'horizontal',
  onRatioChange,
}: SplitLayoutProps) {
  const [ratio, setRatio] = useState(initialRatio);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle drag to resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      let newRatio: number;

      if (orientation === 'horizontal') {
        newRatio = (e.clientX - rect.left) / rect.width;
      } else {
        newRatio = (e.clientY - rect.top) / rect.height;
      }

      // Clamp ratio between 20% and 80%
      newRatio = Math.max(0.2, Math.min(0.8, newRatio));
      setRatio(newRatio);
      onRatioChange?.(newRatio);
    },
    [isDragging, orientation, onRatioChange]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Add/remove global mouse listeners for drag
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = orientation === 'horizontal' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, handleMouseMove, handleMouseUp, orientation]);

  const isHorizontal = orientation === 'horizontal';
  const leftSize = `${ratio * 100}%`;
  const rightSize = `${(1 - ratio) * 100}%`;

  return (
    <div
      ref={containerRef}
      className={`h-full flex ${isHorizontal ? 'flex-row' : 'flex-col'}`}
    >
      {/* Left/Top Pane */}
      <div
        className="overflow-hidden"
        style={{ [isHorizontal ? 'width' : 'height']: leftSize }}
      >
        {renderPane(leftPage, sessionId)}
      </div>

      {/* Divider */}
      <div
        onMouseDown={handleMouseDown}
        className={`
          flex-shrink-0 bg-base-300 hover:bg-primary/50 transition-colors
          ${isHorizontal ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'}
          ${isDragging ? 'bg-primary' : ''}
        `}
      >
        {/* Drag handle visual indicator */}
        <div
          className={`
            flex items-center justify-center h-full w-full
            ${isDragging ? 'bg-primary/20' : ''}
          `}
        >
          <div
            className={`
              bg-base-content/30 rounded-full
              ${isHorizontal ? 'w-0.5 h-8' : 'w-8 h-0.5'}
            `}
          />
        </div>
      </div>

      {/* Right/Bottom Pane */}
      <div
        className="overflow-hidden"
        style={{ [isHorizontal ? 'width' : 'height']: rightSize }}
      >
        {renderPane(rightPage, sessionId)}
      </div>
    </div>
  );
}
