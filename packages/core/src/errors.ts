/**
 * Error thrown by Core validators. `code` is a stable machine-readable
 * identifier; `path` carries the offending resource path when one is known.
 */
export class ValidationError extends Error {
  readonly code: string;
  readonly path: string | undefined;

  constructor(code: string, message: string, path?: string) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.path = path;
  }
}
