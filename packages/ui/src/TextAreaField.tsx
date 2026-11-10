import type { TextareaHTMLAttributes } from "react";

export interface TextAreaFieldProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> {
  label: string;
  name: string;
  value: string;
  onValueChange: (value: string) => void;
  error?: string | undefined;
}

/**
 * A labelled textarea in the same `ui-field` frame as TextField — for
 * multi-line values (a Test Email message, long notes). The caller owns the
 * value; `rows` sizes it.
 */
export function TextAreaField({
  label,
  name,
  value,
  onValueChange,
  error,
  rows = 6,
  ...rest
}: TextAreaFieldProps) {
  const invalid = Boolean(error);
  return (
    <div className={["ui-field", invalid && "ui-field--invalid"].filter(Boolean).join(" ")}>
      <label className="ui-field__label" htmlFor={name}>
        {label}
      </label>
      <textarea
        id={name}
        name={name}
        rows={rows}
        className="ui-field__input ui-field__textarea"
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
