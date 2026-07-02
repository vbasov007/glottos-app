import { CEFR_LEVELS, type CefrEntry, type CefrLevel } from '../lib/cefr-types';

interface Props {
  entry: CefrEntry;
  labels: {
    /** Heading line, e.g. "Completing this lesson will add:" */
    intro: string;
    vocabulary: string;
    grammar: string;
  };
}

const LEVEL_BG: Record<CefrLevel, string> = {
  A1: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  A2: 'bg-teal-100 text-teal-800 dark:bg-teal-950/40 dark:text-teal-300',
  B1: 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
  B2: 'bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300',
  C1: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
};

function formatPct(n: number): string {
  if (n >= 10) return `${Math.round(n)}%`;
  if (n >= 1) return `${n.toFixed(0)}%`;
  return `${n.toFixed(1)}%`;
}

function Row({ label, breakdown }: { label: string; breakdown: Record<CefrLevel, number> }) {
  const present = CEFR_LEVELS.filter((l) => (breakdown[l] ?? 0) > 0);
  return (
    <div className="flex items-center gap-2 text-xs flex-wrap">
      <span className="text-zinc-500 font-medium min-w-[5.5rem]">{label}</span>
      {present.length === 0 ? (
        <span className="text-zinc-400">—</span>
      ) : (
        present.map((l) => (
          <span
            key={l}
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono ${LEVEL_BG[l]}`}
          >
            <span className="font-semibold">{l}</span>
            <span>+{formatPct(breakdown[l])}</span>
          </span>
        ))
      )}
    </div>
  );
}

export function CefrLessonContribution({ entry, labels }: Props) {
  return (
    <div className="mt-3 space-y-1.5">
      <p className="text-xs italic text-zinc-500">{labels.intro}</p>
      <Row label={labels.vocabulary} breakdown={entry.vocabulary} />
      <Row label={labels.grammar} breakdown={entry.grammar} />
    </div>
  );
}
