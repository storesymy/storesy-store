import type { ReactNode } from "react";

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}

export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <div className="auth">
      <div className="auth__panel">
        <div className="auth__brand">
          <img className="auth__logo" src="/storesy-icon.png" alt="" width={30} height={30} />
          <span className="auth__brandName">Storesy</span>
        </div>
        <h1 className="auth__title">{title}</h1>
        <p className="auth__subtitle">{subtitle}</p>
        {children}
        <div className="auth__footer">{footer}</div>
      </div>
    </div>
  );
}
