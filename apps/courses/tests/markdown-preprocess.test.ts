import { describe, it, expect } from 'vitest';
import { fixIntraWordBold } from '../lib/markdown-preprocess';

describe('fixIntraWordBold', () => {
  it('rewrites the elision pattern that CommonMark drops', () => {
    expect(fixIntraWordBold("**n'**aime")).toBe("<strong>n'</strong>aime");
    expect(fixIntraWordBold("**l'**ami")).toBe("<strong>l'</strong>ami");
    expect(fixIntraWordBold("**c'**est")).toBe("<strong>c'</strong>est");
  });

  it('rewrites across multiple occurrences on the same line', () => {
    expect(fixIntraWordBold("Je **n'**aime pas. Tu **n'**aimes pas.")).toBe(
      "Je <strong>n'</strong>aime pas. Tu <strong>n'</strong>aimes pas.",
    );
  });

  it('handles non-Latin scripts on the letter side', () => {
    expect(fixIntraWordBold("**Я'**иду")).toBe("<strong>Я'</strong>иду");
  });

  it('leaves normal bold alone', () => {
    expect(fixIntraWordBold('**Hello**, world')).toBe('**Hello**, world');
    expect(fixIntraWordBold('a **bold** word')).toBe('a **bold** word');
    expect(fixIntraWordBold('**foo, bar.**')).toBe('**foo, bar.**');
  });

  it('leaves intra-word bold without internal punctuation alone (CommonMark handles it)', () => {
    expect(fixIntraWordBold('**parle**z')).toBe('**parle**z');
    expect(fixIntraWordBold('parle**z**')).toBe('parle**z**');
  });

  it('leaves bold followed by space or end-of-line alone', () => {
    expect(fixIntraWordBold("**n'** is the negation")).toBe(
      "**n'** is the negation",
    );
    expect(fixIntraWordBold("end with **foo'**")).toBe("end with **foo'**");
  });

  it('matches a variety of trailing punctuation', () => {
    expect(fixIntraWordBold('**X.**y')).toBe('<strong>X.</strong>y');
    expect(fixIntraWordBold('**X!**y')).toBe('<strong>X!</strong>y');
    expect(fixIntraWordBold('**X?**y')).toBe('<strong>X?</strong>y');
    expect(fixIntraWordBold('**X»**y')).toBe('<strong>X»</strong>y');
  });
});
