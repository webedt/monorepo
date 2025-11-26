import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

// Custom components for markdown rendering
const components: Components = {
  // Links open in new tab
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-info underline hover:text-info-content"
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </a>
  ),
  // Code blocks with syntax highlighting styling
  code: ({ className, children, ...props }) => {
    const isInline = !className;
    if (isInline) {
      return (
        <code className="bg-base-300 px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  // Pre blocks for code
  pre: ({ children }) => (
    <pre className="bg-base-300 p-3 rounded-lg overflow-x-auto text-sm font-mono my-2">
      {children}
    </pre>
  ),
  // Paragraphs
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  // Unordered lists
  ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
  // Ordered lists
  ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
  // List items
  li: ({ children }) => <li className="ml-2">{children}</li>,
  // Headings
  h1: ({ children }) => <h1 className="text-xl font-bold mb-2 mt-3">{children}</h1>,
  h2: ({ children }) => <h2 className="text-lg font-bold mb-2 mt-3">{children}</h2>,
  h3: ({ children }) => <h3 className="text-base font-bold mb-1 mt-2">{children}</h3>,
  h4: ({ children }) => <h4 className="text-sm font-bold mb-1 mt-2">{children}</h4>,
  // Blockquotes
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-base-300 pl-3 my-2 italic opacity-80">
      {children}
    </blockquote>
  ),
  // Horizontal rules
  hr: () => <hr className="my-4 border-base-300" />,
  // Strong/bold
  strong: ({ children }) => <strong className="font-bold">{children}</strong>,
  // Emphasis/italic
  em: ({ children }) => <em className="italic">{children}</em>,
  // Tables (GFM)
  table: ({ children }) => (
    <div className="overflow-x-auto my-2">
      <table className="table table-sm table-zebra w-full">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-base-200">{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr>{children}</tr>,
  th: ({ children }) => <th className="px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="px-2 py-1">{children}</td>,
};

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={`markdown-content ${className || ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default MarkdownRenderer;
