export function formatDateTime(value: string | null) {
  if (!value) {
    return 'Not yet';
  }

  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function formatRelativeDuration(startedAt: string | null, finishedAt: string | null) {
  if (!startedAt || !finishedAt) {
    return 'In progress';
  }

  const elapsedMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  const seconds = Math.max(Math.round(elapsedMs / 1000), 0);

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainderSeconds = seconds % 60;
  return `${minutes}m ${remainderSeconds}s`;
}

export function formatBytes(value: number | null | undefined) {
  if (!value) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
