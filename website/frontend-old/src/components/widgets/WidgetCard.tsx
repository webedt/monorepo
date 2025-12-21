import type { WidgetConfig } from '@/hooks/useWidgetPreferences';

interface WidgetCardProps {
  widget: WidgetConfig;
  children: React.ReactNode;
  isDragging?: boolean;
  onDragStart?: (e: React.DragEvent, widgetId: string) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent, widgetId: string) => void;
}

export function WidgetCard({
  widget,
  children,
  isDragging,
  onDragStart,
  onDragOver,
  onDrop,
}: WidgetCardProps) {
  return (
    <div
      className={`bg-base-100 rounded-xl shadow-lg overflow-hidden transition-all duration-200 ${
        isDragging ? 'opacity-50 scale-95' : ''
      }`}
      draggable
      onDragStart={(e) => onDragStart?.(e, widget.id)}
      onDragOver={onDragOver}
      onDrop={(e) => onDrop?.(e, widget.id)}
      onDragEnd={() => {}}
    >
      {/* Widget Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-base-200 border-b border-base-300 cursor-move">
        <h3 className="font-semibold text-base-content flex items-center gap-2">
          <svg
            className="w-4 h-4 text-base-content/50"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 8h16M4 16h16"
            />
          </svg>
          {widget.title}
        </h3>
      </div>
      {/* Widget Content */}
      <div className="p-4">{children}</div>
    </div>
  );
}
