/** Shared JSON-error response helper. */
export function jsonError(message: string, status = 400) {
	return Response.json({ error: message }, { status })
}
