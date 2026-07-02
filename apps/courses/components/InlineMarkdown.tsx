import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Render inline markdown without the surrounding <p> block. Use for small UI
 * surfaces (verdict line, hint reveal, test-result row) where the canonical
 * answer may contain `**bold**`, `*italic*`, or inline code — for example
 * `Er **liest** jeden Abend die Zeitung. *(e→ie)*`. Plain text passes through
 * untouched.
 *
 * Components are scoped to inline elements only; block elements (lists,
 * headings, etc.) would look wrong here. Block-level rendering belongs in
 * MarkdownRenderer.
 */
export function InlineMarkdown({ source, className }: { source: string; className?: string }) {
  return (
    <span className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <>{children}</>,
          // Defensive: if the input accidentally contains a heading/list, render
          // it inline instead of as a block, so the layout doesn't break.
          h1: ({ children }) => <>{children}</>,
          h2: ({ children }) => <>{children}</>,
          h3: ({ children }) => <>{children}</>,
          h4: ({ children }) => <>{children}</>,
          ul: ({ children }) => <>{children}</>,
          ol: ({ children }) => <>{children}</>,
          li: ({ children }) => <>{children}</>,
        }}
      >
        {source}
      </ReactMarkdown>
    </span>
  );
}
