import { useState, useRef, useEffect, useCallback } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { getLanguageFromFilename } from '@/lib/utils';

interface SyntaxHighlightedEditorProps {
  content: string;
  filename: string;
  onChange: (value: string, selectionStart: number, selectionEnd: number) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  className?: string;
}

/**
 * A code editor component with syntax highlighting.
 *
 * This component uses an overlay approach:
 * - A visible syntax-highlighted layer for display
 * - A transparent textarea on top for editing
 *
 * This allows for proper editing behavior while showing syntax highlighting.
 */
export function SyntaxHighlightedEditor({
  content,
  filename,
  onChange,
  onKeyDown,
  className = '',
}: SyntaxHighlightedEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDarkMode, setIsDarkMode] = useState(true);

  // Detect theme from document
  useEffect(() => {
    const checkTheme = () => {
      const html = document.documentElement;
      const theme = html.getAttribute('data-theme');
      // Check for common dark theme names
      const darkThemes = ['dark', 'dracula', 'night', 'coffee', 'forest', 'black', 'luxury', 'halloween', 'business', 'synthwave', 'cyberpunk', 'dim', 'sunset'];
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

  // Sync scroll between textarea and syntax highlighter
  const handleScroll = useCallback(() => {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  // Get the language for syntax highlighting
  const language = getLanguageFromFilename(filename);

  // Handle content changes
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const target = e.target;
    onChange(target.value, target.selectionStart, target.selectionEnd);
  };

  // Count lines for line numbers
  const lineCount = content.split('\n').length;

  // Custom style overrides for the syntax highlighter to match our editor
  const customStyle: React.CSSProperties = {
    margin: 0,
    padding: '1rem',
    background: 'transparent',
    fontSize: '0.875rem',
    lineHeight: '1.5rem',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    overflow: 'hidden',
    whiteSpace: 'pre',
    wordWrap: 'normal',
    minHeight: '100%',
  };

  return (
    <div className={`flex h-full min-h-0 ${className}`}>
      {/* Line Numbers */}
      <pre className="bg-base-300/50 text-base-content/40 font-mono text-sm py-4 pr-2 pl-3 select-none overflow-hidden flex-shrink-0 text-right leading-6 m-0">
        {Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')}
      </pre>

      {/* Editor Container with overlay */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        {/* Syntax highlighted layer (behind) */}
        <div
          ref={highlightRef}
          className="absolute inset-0 overflow-hidden pointer-events-none"
          aria-hidden="true"
        >
          <SyntaxHighlighter
            language={language}
            style={isDarkMode ? oneDark : oneLight}
            customStyle={customStyle}
            codeTagProps={{
              style: {
                fontFamily: 'inherit',
                fontSize: 'inherit',
                lineHeight: 'inherit',
              },
            }}
            showLineNumbers={false}
            wrapLines={false}
            wrapLongLines={false}
          >
            {content || ' '}
          </SyntaxHighlighter>
        </div>

        {/* Textarea layer (on top, transparent text) */}
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleChange}
          onScroll={handleScroll}
          onKeyDown={onKeyDown}
          className="absolute inset-0 w-full h-full bg-transparent text-transparent caret-base-content font-mono text-sm p-4 resize-none focus:outline-none leading-6 overflow-auto border-none selection:bg-primary/30"
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          style={{
            tabSize: 2,
            MozTabSize: 2,
            caretColor: 'currentColor',
          }}
        />
      </div>
    </div>
  );
}

export default SyntaxHighlightedEditor;
