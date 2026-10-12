import type { JobProgress as JobProgressShape } from '../lib/types';

type JobProgressProps = {
  progress: JobProgressShape;
};

const VISIBLE_FIELDS: Array<[keyof JobProgressShape, string]> = [
  ['filesScanned', 'Files scanned'],
  ['filesParsed', 'Files parsed'],
  ['chunksCreated', 'Chunks'],
  ['vectorsUpserted', 'Vectors'],
  ['parseFailures', 'Parse failures'],
  ['added', 'Added'],
  ['changed', 'Changed'],
  ['deleted', 'Deleted'],
];

export function JobProgress({ progress }: JobProgressProps) {
  const items = VISIBLE_FIELDS.filter(([key]) => progress[key] !== null);

  if (items.length === 0) {
    return <p className="muted-copy">No progress metrics reported yet.</p>;
  }

  return (
    <div className="metric-grid compact">
      {items.map(([key, label]) => (
        <div key={key} className="mini-stat">
          <span>{label}</span>
          <strong>{progress[key]}</strong>
        </div>
      ))}
    </div>
  );
}
