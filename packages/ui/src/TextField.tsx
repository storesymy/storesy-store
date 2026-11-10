import type { InputHTMLAttributes } from "react";

export interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  label: string;
  name: string;
  value: string;
  onValueChange: (value: string) => void;
  error?: string | undefined;
}

export function TextField({
  label,
  name,
  value,
  onValueChange,
  error,
  type = "text",
  ...rest
}: TextFieldProps) {
  const invalid = Boolean(error);
  return (
    <div className={["ui-field", invalid && "ui-field--invalid"].filter(Boolean).join(" ")}>
      <label className="ui-field__label" htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        className="ui-field__input"
        value={value}
        aria-invalid={invalid}
        aria-describedby={invalid ? `${name}-error` : undefined}
        onChange={(event) => onValueChange(event.target.value)}
        {...rest}
      />
      {invalid ? (
        <p className="ui-field__error" id={`${name}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
