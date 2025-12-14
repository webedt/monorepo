import { type ReactNode, useState, useRef, useEffect } from 'react';
import type { DashboardWidget } from '@/hooks/useDashboardLayout';

/**
 * Props for the DraggableWidget component
 */
interface DraggableWidgetProps {
  /** The widget configuration */
  widget: DashboardWidget;
  /** Content to render inside the widget */
  children: ReactNode;
  /** Whether this widget is currently being dragged */
  isDragging?: boolean;
  /** Whether drag-and-drop is enabled */
  isDragEnabled?: boolean;
  /** Whether we're in customization mode */
  isCustomizing?: boolean;
  /** Handler called when drag starts */
  onDragStart?: (e: React.DragEvent, widgetId: string) => void;
  /** Handler called during drag over */
  onDragOver?: (e: React.DragEvent) => void;
  /** Handler called when widget is dropped */
  onDrop?: (e: React.DragEvent, widgetId: string) => void;
  /** Handler called when drag ends */
  onDragEnd?: () => void;
  /** Handler for visibility toggle */
  onToggleVisibility?: (widgetId: string) => void;
  /** Handler for moving widget up */
  onMoveUp?: (widgetId: string) => void;
  /** Handler for moving widget down */
  onMoveDown?: (widgetId: string) => void;
  /** Whether this is the first widget (disable move up) */
  isFirst?: boolean;
  /** Whether this is the last widget (disable move down) */
  isLast?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * DraggableWidget - An enhanced widget container with drag-and-drop support
 *
 * Features:
 * - Drag-and-drop reordering with visual feedback
 * - Touch support for mobile devices
 * - Visibility toggle in customization mode
 * - Move up/down buttons for accessibility
 * - Smooth animations and transitions
 *
 * Implements SPEC.md Section 2.1:
 * - Drag-and-drop widget arrangement
 * - Visual feedback during drag operations
 */
export function DraggableWidget({
  widget,
  children,
  isDragging = false,
  isDragEnabled = true,
  isCustomizing = false,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onToggleVisibility,
  onMoveUp,
  onMoveDown,
  isFirst = false,
  isLast = false,
  className = '',
}: DraggableWidgetProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isDraggedOver, setIsDraggedOver] = useState(false);
  const widgetRef = useRef<HTMLDivElement>(null);

  // Touch drag state for mobile
  const [touchDragState, setTouchDragState] = useState<{
    isDragging: boolean;
    startY: number;
    currentY: number;
  } | null>(null);

  // Handle touch start for mobile drag
  const handleTouchStart = (e: React.TouchEvent) => {
    if (!isDragEnabled) return;

    const touch = e.touches[0];
    setTouchDragState({
      isDragging: false,
      startY: touch.clientY,
      currentY: touch.clientY,
    });
  };

  // Handle touch move for mobile drag
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchDragState || !isDragEnabled) return;

    const touch = e.touches[0];
    const deltaY = Math.abs(touch.clientY - touchDragState.startY);

    // Start drag if moved more than 10px
    if (deltaY > 10 && !touchDragState.isDragging) {
      setTouchDragState({
        ...touchDragState,
        isDragging: true,
        currentY: touch.clientY,
      });
    } else if (touchDragState.isDragging) {
      setTouchDragState({
        ...touchDragState,
        currentY: touch.clientY,
      });
    }
  };

  // Handle touch end for mobile drag
  const handleTouchEnd = () => {
    setTouchDragState(null);
  };

  // Handle drag over with visual feedback
  const handleLocalDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggedOver(true);
    onDragOver?.(e);
  };

  // Handle drag leave
  const handleDragLeave = () => {
    setIsDraggedOver(false);
  };

  // Handle drop
  const handleLocalDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggedOver(false);
    onDrop?.(e, widget.id);
  };

  // Clean up drag over state when drag ends elsewhere
  useEffect(() => {
    const handleGlobalDragEnd = () => {
      setIsDraggedOver(false);
    };

    window.addEventListener('dragend', handleGlobalDragEnd);
    return () => window.removeEventListener('dragend', handleGlobalDragEnd);
  }, []);

  return (
    <div
      ref={widgetRef}
      className={`
        group relative
        bg-base-100 rounded-xl shadow-lg overflow-hidden
        transition-all duration-200 ease-in-out
        ${isDragging ? 'opacity-50 scale-95 ring-2 ring-primary shadow-xl z-10' : ''}
        ${isDraggedOver && !isDragging ? 'ring-2 ring-primary/50 scale-[1.02]' : ''}
        ${isDragEnabled && !isDragging ? 'hover:shadow-xl' : ''}
        ${isCustomizing ? 'ring-1 ring-base-300' : ''}
        ${touchDragState?.isDragging ? 'opacity-75 scale-95' : ''}
        ${className}
      `}
      draggable={isDragEnabled}
      onDragStart={(e) => isDragEnabled && onDragStart?.(e, widget.id)}
      onDragOver={handleLocalDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleLocalDrop}
      onDragEnd={onDragEnd}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      role="article"
      aria-label={`${widget.title} widget`}
      aria-grabbed={isDragging}
    >
      {/* Widget Header */}
      <div
        className={`
          flex items-center justify-between px-4 py-3
          bg-base-200 border-b border-base-300
          ${isDragEnabled ? 'cursor-move select-none' : ''}
        `}
      >
        <h3 className="font-semibold text-base-content flex items-center gap-2">
          {/* Drag handle icon */}
          {isDragEnabled && (
            <svg
              className="w-4 h-4 text-base-content/50 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 8h16M4 16h16"
              />
            </svg>
          )}
          {widget.title}
        </h3>

        {/* Widget Controls - Show on hover or in customization mode */}
        <div
          className={`
            flex items-center gap-1
            transition-opacity duration-150
            ${isCustomizing || isHovered ? 'opacity-100' : 'opacity-0'}
          `}
        >
          {/* Move Up Button */}
          {isCustomizing && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMoveUp?.(widget.id);
              }}
              disabled={isFirst}
              className="btn btn-ghost btn-xs btn-square"
              title="Move up"
              aria-label="Move widget up"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 15l7-7 7 7"
                />
              </svg>
            </button>
          )}

          {/* Move Down Button */}
          {isCustomizing && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMoveDown?.(widget.id);
              }}
              disabled={isLast}
              className="btn btn-ghost btn-xs btn-square"
              title="Move down"
              aria-label="Move widget down"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
          )}

          {/* Hide Widget Button */}
          {isCustomizing && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleVisibility?.(widget.id);
              }}
              className="btn btn-ghost btn-xs btn-square text-error"
              title="Hide widget"
              aria-label="Hide widget"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Widget Content */}
      <div className="p-4">
        {children}
      </div>

      {/* Drop zone indicator */}
      {isDraggedOver && !isDragging && (
        <div
          className="
            absolute inset-0 pointer-events-none
            bg-primary/10 border-2 border-dashed border-primary
            rounded-xl flex items-center justify-center
          "
        >
          <span className="text-primary font-medium text-sm bg-base-100 px-3 py-1 rounded-full shadow">
            Drop here
          </span>
        </div>
      )}
    </div>
  );
}

export default DraggableWidget;
