'use client';

import type { ReactNode } from 'react';
import { SpeakButton } from './SpeakButton';
import type { TargetLang } from '../lib/content-types';

function flattenText(node: ReactNode): string {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join('');
  if (typeof node === 'object' && 'props' in node) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    return flattenText(props?.children);
  }
  return '';
}

interface SayInlineProps {
  children?: ReactNode;
  lang: TargetLang;
}

export function SayInline({ children, lang }: SayInlineProps) {
  const text = flattenText(children).trim();
  if (!text) return null;
  return (
    <span className="inline-flex items-baseline gap-1 align-baseline">
      <span>{children}</span>
      <SpeakButton text={text} lang={lang} size="sm" className="translate-y-0.5" />
    </span>
  );
}
