'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';
import { fixIntraWordBold } from '../lib/markdown-preprocess';
import { SayInline } from './SayInline';
import type { TargetLang } from '../lib/content-types';

interface Props {
  source: string;
  /** When set, `<say>…</say>` inside the markdown renders an inline speaker
   *  button that plays the wrapped text through TTS in this target language. */
  targetLang?: TargetLang;
}

export function MarkdownRenderer({ source, targetLang }: Props) {
  const components: Components | undefined = targetLang
    ? ({
        // react-markdown lowercases unknown HTML tags. `<say>` maps to this.
        // The Components map's value typing is permissive but TS still wants
        // `unknown` for non-HTML elements — the inline cast is safe.
        say: ({ children }: { children?: React.ReactNode }) => (
          <SayInline lang={targetLang}>{children}</SayInline>
        ),
      } as unknown as Components)
    : undefined;

  return (
    <div className="prose-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSlug]}
        components={components}
      >
        {fixIntraWordBold(source)}
      </ReactMarkdown>
    </div>
  );
}
