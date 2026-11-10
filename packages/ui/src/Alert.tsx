export interface AlertProps {
  tone?: "error" | "success" | "info";
  children: string;
}

export function Alert({ tone = "error", children }: AlertProps) {
  return (
    <p className={`ui-alert ui-alert--${tone}`} role="alert">
      {children}
    </p>
  );
}
