import type { ReactNode } from 'react';

type EmptyStateProps = {
  title: string;
  copy: string;
  action?: ReactNode;
};

export function EmptyState({ title, copy, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <p className="eyebrow">Nothing live yet</p>
      <h3>{title}</h3>
      <p>{copy}</p>
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  );
}
