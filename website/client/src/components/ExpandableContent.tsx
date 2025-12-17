import { useState } from 'react';

// Expandable text component - shows truncated text with expand option
// When expanded, appends remaining text inline instead of re-displaying everything
export function ExpandableText({ text, maxLength = 150, className = '' }: { text: string; maxLength?: number; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const needsTruncate = text.length > maxLength;

  if (!needsTruncate) {
    return <span className={className}>{text}</span>;
  }

  const truncatedPart = text.substring(0, maxLength);
  const remainingPart = text.substring(maxLength);

  return (
    <span className={className}>
      {truncatedPart}
      {expanded ? (
        <>
          {remainingPart}
          <button
            onClick={() => setExpanded(false)}
            className="ml-1 text-primary hover:underline text-xs"
          >
            [collapse]
          </button>
        </>
      ) : (
        <button
          onClick={() => setExpanded(true)}
          className="text-primary hover:underline text-xs"
        >
          ...
        </button>
      )}
    </span>
  );
}

// Expandable JSON component - shows JSON with expand/collapse
export function ExpandableJson({ data, summary, defaultOpen = false }: { data: any; summary?: string; defaultOpen?: boolean }) {
  return (
    <details className="mt-1 text-xs" open={defaultOpen}>
      <summary className="cursor-pointer opacity-50 hover:opacity-100">{summary || 'View JSON'}</summary>
      <pre className="mt-1 p-2 bg-base-300 rounded overflow-auto max-h-96">
        {JSON.stringify(data, null, 2)}
      </pre>
    </details>
  );
}
