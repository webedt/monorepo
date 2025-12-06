import { useState, useRef, useEffect } from 'react';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import type { Message } from '@/shared';
import type { ImageAttachment } from '@/components/ChatInput';

interface ChatMessageProps {
  message: Message & { images?: ImageAttachment[] };
  userName?: string;
  onImageClick?: (image: { data: string; mediaType: string; fileName: string }) => void;
  onRetry?: () => void;
  showRetry?: boolean;
}

export function ChatMessage({ message, userName, onImageClick, onRetry, showRetry }: ChatMessageProps) {
  const [showCopyButton, setShowCopyButton] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [copySuccess, setCopySuccess] = useState(false);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const messageRef = useRef<HTMLDivElement>(null);

  // Copy message content to clipboard
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopySuccess(true);
      setShowContextMenu(false);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Handle long press for mobile
  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };

    longPressTimerRef.current = setTimeout(() => {
      setContextMenuPosition({ x: touch.clientX, y: touch.clientY });
      setShowContextMenu(true);
      // Provide haptic feedback if available
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    }, 500); // 500ms long press
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    // Cancel long press if finger moves too much
    if (touchStartRef.current && longPressTimerRef.current) {
      const touch = e.touches[0];
      const deltaX = Math.abs(touch.clientX - touchStartRef.current.x);
      const deltaY = Math.abs(touch.clientY - touchStartRef.current.y);

      if (deltaX > 10 || deltaY > 10) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchStartRef.current = null;
  };

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (showContextMenu && messageRef.current && !messageRef.current.contains(e.target as Node)) {
        setShowContextMenu(false);
      }
    };

    if (showContextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('touchstart', handleClickOutside);
      };
    }
  }, [showContextMenu]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  return (
    <div
      ref={messageRef}
      className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`relative max-w-3xl rounded-lg px-4 py-2 ${
          message.type === 'user'
            ? 'bg-primary text-primary-content'
            : message.type === 'error'
            ? 'bg-error/10 text-error border border-error/20'
            : 'bg-base-100 text-base-content border border-base-300'
        }`}
        onMouseEnter={() => setShowCopyButton(true)}
        onMouseLeave={() => setShowCopyButton(false)}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Desktop hover copy button */}
        {showCopyButton && !copySuccess && (
          <button
            onClick={handleCopy}
            className="absolute -top-2 -right-2 btn btn-circle btn-xs bg-base-200 hover:bg-base-300 border border-base-300 shadow-md"
            title="Copy message"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-3.5 w-3.5"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
              <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
            </svg>
          </button>
        )}

        {/* Copy success indicator */}
        {copySuccess && (
          <div className="absolute -top-2 -right-2 btn btn-circle btn-xs bg-success text-success-content border border-success shadow-md">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-3.5 w-3.5"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          </div>
        )}

        {/* Mobile context menu */}
        {showContextMenu && (
          <div
            className="fixed bg-base-200 rounded-lg shadow-xl border border-base-300 py-2 z-50"
            style={{
              left: `${contextMenuPosition.x}px`,
              top: `${contextMenuPosition.y}px`,
              transform: 'translate(-50%, -100%) translateY(-10px)',
            }}
          >
            <button
              onClick={handleCopy}
              className="flex items-center gap-2 px-4 py-2 hover:bg-base-300 w-full text-left"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
              </svg>
              <span className="text-sm">Copy</span>
            </button>
          </div>
        )}

        <div className="text-sm">
          <MarkdownRenderer content={message.content} />
        </div>

        {/* Display images if present */}
        {message.images && message.images.length > 0 && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            {message.images.map((image) => (
              <div
                key={image.id}
                className="relative group cursor-pointer"
                onClick={() =>
                  onImageClick?.({
                    data: image.data,
                    mediaType: image.mediaType,
                    fileName: image.fileName,
                  })
                }
              >
                <img
                  src={`data:${image.mediaType};base64,${image.data}`}
                  alt={image.fileName}
                  className="w-full h-32 object-cover rounded border border-white/20 group-hover:border-white/40 transition-colors"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors rounded flex items-center justify-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-8 w-8 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"
                    />
                  </svg>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs mt-1 opacity-70">
          {message.type === 'user'
            ? userName || 'User'
            : message.type === 'assistant'
            ? message.model ? `Claude (${message.model})` : 'Claude'
            : 'Error'}{' '}
          • {new Date(message.timestamp).toLocaleTimeString()}
        </p>

        {showRetry && onRetry && (
          <button onClick={onRetry} className="mt-3 btn btn-error btn-xs">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-3.5 w-3.5 mr-1.5"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
                clipRule="evenodd"
              />
            </svg>
            Retry Request
          </button>
        )}
      </div>
    </div>
  );
}
