// Client-safe CEFR types and constants. No node:* imports so this can be
// pulled into the client bundle by progress-bar components.

export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];
export type CefrBreakdown = Record<CefrLevel, number>;

export interface CefrEntry {
  vocabulary: CefrBreakdown;
  grammar: CefrBreakdown;
}
