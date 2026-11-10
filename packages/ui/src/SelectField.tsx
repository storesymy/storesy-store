import type { SelectHTMLAttributes } from "react";

export interface SelectFieldProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value"> {
  label: string;
  name: string;
  value: string;
  /** Allowed values, in order; the first is the natural default. */
  options: readonly string[];
  onValueChange: (value: string) => void;
  error?: string | undefined;
}

/**
 * A labelled dropdown in the same `ui-field` frame as TextField — for fields
 * whose value is a fixed set (an API host, a region). The caller owns the
 * value; the first option doubles as the default.
 */
export function SelectField({
  label,
  name,
  value,
  options,
  onValueChange,
  error,
  ...rest
}: SelectFieldProps) {
  const invalid = Boolean(error);
  return (
    <div className={["ui-field", invalid && "ui-field--invalid"].filter(Boolean).join(" ")}>
      <label className="ui-field__label" htmlFor={name}>
        {label}
      </label>
      <select
        id={name}
        name={name}
        className="ui-field__select"
        value={value}
        aria-invalid={invalid}
        aria-describedby={invalid ? `${name}-error` : undefined}
        onChange={(event) => onValueChange(event.target.value)}
        {...rest}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      {invalid ? (
        <p className="ui-field__error" id={`${name}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
