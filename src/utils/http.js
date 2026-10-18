/** Error carrying an HTTP status — the equivalent of Laravel's `abort()`. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/** 422 with a field-keyed bag, matching Laravel's ValidationException payload. */
export class ValidationError extends HttpError {
  constructor(errors) {
    const first = Object.values(errors)[0];
    super(422, Array.isArray(first) ? first[0] : String(first));
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

/** `abort(403, '...')` */
export function abort(status, message) {
  throw new HttpError(status, message);
}

/** `abort_unless($condition, 403)` */
export function abortUnless(condition, status, message) {
  if (!condition) abort(status, message);
}

/** `abort_if($condition, 403)` */
export function abortIf(condition, status, message) {
  if (condition) abort(status, message);
}
