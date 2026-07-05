'use client';

import { useEffect } from 'react';
import { useProgressStore } from '../lib/store';
import type { CourseSlug, NativeLang, TargetLang } from '../lib/content-types';

interface Props {
  course: CourseSlug;
  targetLang: TargetLang;
  nativeLang: NativeLang;
  textN: number;
  variant: string;
}

/** Renders nothing. Records that this listening text was opened so its
 *  vocabulary counts toward the dashboard "words seen" metric. */
export function TextRead({ course, targetLang, nativeLang, textN, variant }: Props) {
  const courseKey = `${course}.${targetLang}.${nativeLang}` as const;
  const markTextRead = useProgressStore((s) => s.markTextRead);
  useEffect(() => {
    markTextRead(courseKey, `${textN}-${variant}`);
  }, [courseKey, textN, variant, markTextRead]);
  return null;
}
