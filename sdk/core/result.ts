export type Result<Value, ErrorValue> = { ok: true; value: Value } | { ok: false; error: ErrorValue }

export const success = <Value>(value: Value): Result<Value, never> => ({ ok: true, value })

export const failure = <ErrorValue>(error: ErrorValue): Result<never, ErrorValue> => ({ ok: false, error })
