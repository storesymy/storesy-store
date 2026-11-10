/**
 * Every failure the API can produce is an AppError. Controllers throw; the
 * entrypoint converts to the single error envelope: { error: { code, message, fields? } }.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;
  readonly headers?: Record<string, string>;

  constructor(
    status: number,
    code: string,
    message: string,
    options: {
      fields?: Record<string, string>;
      headers?: Record<string, string>;
    } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.fields = options.fields;
    this.headers = options.headers;
  }
}

export const badRequest = (code: string, message: string) => new AppError(400, code, message);

export const unauthorized = (code = "unauthorized", message = "Authentication required") =>
  new AppError(401, code, message);

export const forbidden = (code: string, message: string) => new AppError(403, code, message);

export const notFound = (code = "not_found", message = "Resource not found") =>
  new AppError(404, code, message);

export const conflict = (code: string, message: string) => new AppError(409, code, message);

export const validationFailed = (message: string, fields: Record<string, string>) =>
  new AppError(422, "validation_failed", message, { fields });

export const tooManyRequests = (message: string, retryAfterSeconds: number) =>
  new AppError(429, "rate_limited", message, {
    headers: { "Retry-After": String(retryAfterSeconds) },
  });

export const internal = (message = "Something went wrong") => new AppError(500, "internal_error", message);

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
