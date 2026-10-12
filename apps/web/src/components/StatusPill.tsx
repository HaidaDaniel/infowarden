type StatusPillProps = {
  status: string | null;
};

export function StatusPill({ status }: StatusPillProps) {
  const normalized = status ?? 'unknown';

  return <span className={`status-pill ${normalized}`}>{normalized.replace(/_/g, ' ')}</span>;
}
