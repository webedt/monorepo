import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { getLanguageFromFilename } from '@/lib/utils';

interface SyntaxHighlightedEditorProps {
  content: string;
  filename: string;
  onChange: (value: string, selectionStart: number, selectionEnd: number) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  className?: string;
  /** Ghost text suggestion to display (AI autocomplete) */
  ghostText?: string | null;
  /** Cursor position where ghost text should appear */
  ghostTextPosition?: number | null;
  /** Callback when ghost text is accepted (e.g., Tab pressed) */
  onAcceptGhostText?: () => void;
  /** Whether ghost text is loading */
  isGhostTextLoading?: boolean;
}

/**
 * A code editor component with syntax highlighting.
 *
 * This component uses an overlay approach:
 * - A visible syntax-highlighted layer for display
 * - A transparent textarea on top for editing
 *
 * This allows for proper editing behavior while showing syntax highlighting.
 *
 * Performance optimizations:
 * - Component wrapped in memo() to prevent re-renders when props haven't changed
 * - SyntaxHighlighter output memoized to avoid re-tokenization on every keystroke
 * - Style objects memoized to prevent unnecessary re-renders
 */
export const SyntaxHighlightedEditor = memo(function SyntaxHighlightedEditor({
  content,
  filename,
  onChange,
  onKeyDown,
  className = '',
  ghostText,
  ghostTextPosition,
  onAcceptGhostText,
  isGhostTextLoading,
}: SyntaxHighlightedEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lineNumbersRef = useRef<HTMLPreElement>(null);
  const [isDarkMode, setIsDarkMode] = useState(true);

  // Detect theme from document
  useEffect(() => {
    const checkTheme = () => {
      const html = document.documentElement;
      const theme = html.getAttribute('data-theme');
      // Check for common dark theme names
      const darkThemes = ['dark', 'biotin', 'dracula', 'night', 'coffee', 'forest', 'black', 'luxury', 'halloween', 'business', 'synthwave', 'cyberpunk', 'dim', 'sunset'];
      setIsDarkMode(theme ? darkThemes.some(t => theme.toLowerCase().includes(t)) : true);
    };

    checkTheme();

    // Create observer to detect theme changes
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => observer.disconnect();
  }, []);

  // Sync scroll between textarea, syntax highlighter, and line numbers
  const handleScroll = useCallback(() => {
    if (textareaRef.current) {
      const scrollTop = textareaRef.current.scrollTop;
      const scrollLeft = textareaRef.current.scrollLeft;

      if (highlightRef.current) {
        highlightRef.current.scrollTop = scrollTop;
        highlightRef.current.scrollLeft = scrollLeft;
      }

      // Sync line numbers vertical scroll
      if (lineNumbersRef.current) {
        lineNumbersRef.current.scrollTop = scrollTop;
      }
    }
  }, []);

  // Get the language for syntax highlighting
  const language = getLanguageFromFilename(filename);

  // Handle content changes
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const target = e.target;
    onChange(target.value, target.selectionStart, target.selectionEnd);
  };

  // Handle keyboard events (Tab to accept ghost text)
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Tab to accept ghost text
    if (e.key === 'Tab' && ghostText && onAcceptGhostText) {
      e.preventDefault();
      onAcceptGhostText();
      return;
    }

    // Forward to parent handler
    onKeyDown?.(e);
  }, [ghostText, onAcceptGhostText, onKeyDown]);

  // Calculate ghost text position for rendering
  const ghostTextOverlay = useMemo(() => {
    if (!ghostText || ghostTextPosition === null || ghostTextPosition === undefined) {
      return null;
    }

    // Split content at cursor position
    const beforeCursor = content.slice(0, ghostTextPosition);
    const afterCursor = content.slice(ghostTextPosition);

    // Calculate line and column
    const lines = beforeCursor.split('\n');
    const lineNumber = lines.length;
    const column = lines[lines.length - 1].length;

    // Create the ghost text display
    // We'll render invisible text before the ghost to position it correctly
    return {
      lineNumber,
      column,
      prefix: beforeCursor,
      suffix: afterCursor,
    };
  }, [ghostText, ghostTextPosition, content]);

  // Count lines for line numbers - memoized to avoid recalculation on every render
  const lineCount = useMemo(() => {
    const count = content.split('\n').length;
    // Debug: log first 200 chars to see if content has unexpected newlines
    console.log('[SyntaxHighlightedEditor] lineCount:', count, 'content preview:', JSON.stringify(content.substring(0, 200)));
    return count;
  }, [content]);

  // Custom style overrides for the syntax highlighter to match our editor
  // Memoized to prevent SyntaxHighlighter from re-rendering due to style object identity changes
  const customStyle = useMemo<React.CSSProperties>(() => ({
    margin: 0,
    padding: '1rem',
    background: 'transparent',
    fontSize: '0.875rem',
    lineHeight: '1.5rem',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    overflow: 'visible',
    whiteSpace: 'pre',
    wordWrap: 'normal',
    overflowWrap: 'normal',
    minHeight: '100%',
    width: 'max-content',
    minWidth: '100%',
  }), []);

  // Memoize codeTagProps to prevent unnecessary re-renders
  const codeTagProps = useMemo(() => ({
    style: {
      fontFamily: 'inherit',
      fontSize: 'inherit',
      lineHeight: 'inherit',
      whiteSpace: 'pre' as const,
      wordWrap: 'normal' as const,
      overflowWrap: 'normal' as const,
      display: 'block' as const,
    },
  }), []);

  // Custom PreTag to ensure proper whitespace handling
  const PreTag = useMemo(() => {
    return ({ children, ...props }: any) => (
      <pre
        {...props}
        style={{
          ...props.style,
          whiteSpace: 'pre',
          wordWrap: 'normal',
          overflowWrap: 'normal',
          margin: 0,
        }}
      >
        {children}
      </pre>
    );
  }, []);

  // Memoize the syntax highlighter to prevent re-tokenization on every keystroke
  // Only re-render when content, language, or theme actually changes
  const highlightedContent = useMemo(() => (
    <SyntaxHighlighter
      language={language}
      style={isDarkMode ? oneDark : oneLight}
      customStyle={customStyle}
      codeTagProps={codeTagProps}
      PreTag={PreTag}
      showLineNumbers={false}
      wrapLines={false}
      wrapLongLines={false}
    >
      {content || ' '}
    </SyntaxHighlighter>
  ), [content, language, isDarkMode, customStyle, codeTagProps, PreTag]);

  return (
    <div className={`flex h-full min-h-0 ${className}`}>
      {/* Line Numbers - wrapper hides scrollbar, inner pre scrolls with content */}
      <div className="bg-base-300/50 flex-shrink-0 overflow-hidden">
        <pre
          ref={lineNumbersRef}
          className="line-numbers-scroll text-base-content/40 font-mono text-sm py-4 pr-2 pl-3 select-none text-right leading-6 m-0 overflow-y-scroll h-full"
          style={{
            // Hide scrollbar while keeping element scrollable
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
          }}
        >
          {Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')}
        </pre>
      </div>

      {/* Editor Container with overlay */}
      <div ref={containerRef} className="flex-1 relative overflow-auto">
        {/* Syntax highlighted layer (behind) */}
        <div
          ref={highlightRef}
          className="absolute inset-0 overflow-auto pointer-events-none"
          aria-hidden="true"
          style={{
            // Ensure all child elements preserve whitespace and don't wrap
            // This fixes issues with react-syntax-highlighter breaking markdown tables
          }}
        >
          <style>{`
            .syntax-highlight-container span {
              white-space: pre !important;
              word-wrap: normal !important;
              overflow-wrap: normal !important;
            }
            .syntax-highlight-container code {
              white-space: pre !important;
              word-wrap: normal !important;
              overflow-wrap: normal !important;
              display: block !important;
            }
            .line-numbers-scroll::-webkit-scrollbar {
              display: none;
            }
          `}</style>
          <div className="syntax-highlight-container">
            {highlightedContent}
          </div>
        </div>

        {/* Ghost text overlay (AI autocomplete suggestion) */}
        {ghostText && ghostTextOverlay && (
          <div
            className="absolute inset-0 overflow-hidden pointer-events-none font-mono text-sm p-4 leading-6"
            aria-hidden="true"
            style={{
              whiteSpace: 'pre',
              wordWrap: 'normal',
              overflowWrap: 'normal',
            }}
          >
            {/* Invisible prefix text to position the ghost text correctly */}
            <span style={{ visibility: 'hidden' }}>
              {ghostTextOverlay.prefix}
            </span>
            {/* Ghost text suggestion */}
            <span
              className="text-base-content/40 italic"
              style={{
                backgroundColor: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
              }}
            >
              {ghostText}
            </span>
          </div>
        )}

        {/* Loading indicator for ghost text */}
        {isGhostTextLoading && (
          <div className="absolute bottom-2 right-2 flex items-center gap-1 text-xs text-base-content/50 bg-base-300/80 px-2 py-1 rounded">
            <span className="inline-block w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
            <span>Thinking...</span>
          </div>
        )}

        {/* Tab hint when ghost text is shown */}
        {ghostText && !isGhostTextLoading && (
          <div className="absolute bottom-2 right-2 text-xs text-base-content/40 bg-base-300/80 px-2 py-1 rounded">
            Press <kbd className="px-1 py-0.5 bg-base-200 rounded text-base-content/60">Tab</kbd> to accept
          </div>
        )}

        {/* Textarea layer (on top, transparent text) */}
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleChange}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          className="absolute inset-0 w-full h-full bg-transparent text-transparent font-mono text-sm p-4 resize-none focus:outline-none leading-6 overflow-auto border-none selection:bg-primary/30"
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          style={{
            tabSize: 2,
            MozTabSize: 2,
            // Use explicit color for caret visibility - 'currentColor' doesn't work with transparent text
            caretColor: isDarkMode ? '#abb2bf' : '#383a42',
            // Prevent unwanted line wrapping (especially important for markdown tables with | characters)
            whiteSpace: 'pre',
            wordWrap: 'normal',
            overflowWrap: 'normal',
          }}
        />
      </div>
    </div>
  );
});

export default SyntaxHighlightedEditor;
