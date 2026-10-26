import { canonicalJson, CanonicalJsonError } from '@learning-workspace/schemas/canonical';
import { ValidationError } from './errors.js';

export { MAX_CANONICAL_JSON_DEPTH } from '@learning-workspace/schemas/constants';

/** RFC 8785 uses the contract authority; this adapter only preserves Core error types. */
export function canonicalizeJson(value: unknown): string {
  try {
    return canonicalJson(value);
  } catch (error) {
    if (error instanceof CanonicalJsonError) throw new ValidationError(error.code, error.message, error.path);
    throw error;
  }
}
