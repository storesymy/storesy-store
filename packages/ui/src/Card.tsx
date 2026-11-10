import type { ReactNode } from "react";

export interface CardProps {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}

export function Card({ title, action, children }: CardProps) {
  return (
    <section className="ui-card">
      {title || action ? (
        <header className="ui-card__header">
          {title ? <h2 className="ui-card__title">{title}</h2> : <span />}
          {action}
        </header>
      ) : null}
      <div className="ui-card__body">{children}</div>
    </section>
  );
}
