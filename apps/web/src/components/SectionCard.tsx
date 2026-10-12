import type { ReactNode } from 'react';

type SectionCardProps = {
  title: string;
  id?: string;
  eyebrow?: string;
  actions?: ReactNode;
  children: ReactNode;
};

export function SectionCard({ title, id, eyebrow, actions, children }: SectionCardProps) {
  return (
    <section id={id} tabIndex={id ? -1 : undefined} className="section-card">
      <header className="section-header">
        <div>
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h2>{title}</h2>
        </div>
        {actions ? <div>{actions}</div> : null}
      </header>
      <div className="section-body">{children}</div>
    </section>
  );
}
