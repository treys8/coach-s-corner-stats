// Standard response shape and classifier for API route handlers. Keeps the
// shape consistent: `{ error: string-code, detail?: string, issues?: unknown }`.
// Never surfaces raw PostgREST messages or RLS internals to clients.

import { NextResponse } from "next/server";

export interface ApiErrorBody {
  error: string;
  detail?: string;
  issues?: unknown;
}

export function apiError(
  status: number,
  code: string,
  opts: { detail?: string; issues?: unknown } = {},
): NextResponse<ApiErrorBody> {
  const body: ApiErrorBody = { error: code };
  if (opts.detail !== undefined) body.detail = opts.detail;
  if (opts.issues !== undefined) body.issues = opts.issues;
  return NextResponse.json(body, { status });
}

/** Postgres "insufficient privilege" error code surfaced through PostgREST. */
const RLS_SQLSTATE = "42501";
const RLS_MESSAGE_RE = /^forbidden|permission denied|row-level security|42501/i;

/** Postgres "serialization_failure" — used by write_derived_state to signal
 *  that the caller's expected_last_seq didn't match the current event log
 *  (a peer writer interleaved). Retrying with a fresh replay is the
 *  correct response. */
const CONCURRENCY_SQLSTATE = "40001";
const CONCURRENCY_MESSAGE_RE = /concurrency_conflict|serialization_failure|40001/i;

/** Returns true when the error shape matches RLS / permission denial. */
export function isForbiddenError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code === RLS_SQLSTATE) return true;
  }
  const message = err instanceof Error ? err.message
    : (typeof err === "object" && err !== null && "message" in err)
      ? String((err as { message: unknown }).message)
      : "";
  return RLS_MESSAGE_RE.test(message);
}

/** Returns true when the error shape matches a transient serialization /
 *  concurrency conflict — the caller should retry with a fresh read. */
export function isConcurrencyConflictError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code === CONCURRENCY_SQLSTATE) return true;
  }
  const message = err instanceof Error ? err.message
    : (typeof err === "object" && err !== null && "message" in err)
      ? String((err as { message: unknown }).message)
      : "";
  return CONCURRENCY_MESSAGE_RE.test(message);
}

/**
 * Classify a thrown error into a status code + safe response body. Use this
 * inside `catch` blocks where the failure could be RLS or anything else.
 * Never leaks raw PostgREST messages on 5xx; the original message is included
 * as `detail` for client logs but the `error` code is always stable.
 */
export function apiErrorFromException(err: unknown): NextResponse<ApiErrorBody> {
  if (isForbiddenError(err)) {
    return apiError(403, "forbidden");
  }
  const detail = err instanceof Error ? err.message : "unknown";
  return apiError(500, "internal", { detail });
}
