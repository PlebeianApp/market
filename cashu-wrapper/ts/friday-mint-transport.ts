/** A fetch transport whose deadline aborts the underlying mint request. */
export function createBoundedMintFetch(timeoutMs: number, fetchImpl: typeof fetch = fetch): typeof fetch {
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new Error("invalid mint request timeout");
	return (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
		const controller = new AbortController();
		const inherited = init?.signal ?? (input instanceof Request ? input.signal : undefined);
		const forwardAbort = (): void => controller.abort(inherited?.reason);
		if (inherited?.aborted) forwardAbort();
		else inherited?.addEventListener("abort", forwardAbort, { once: true });
		const timer = setTimeout(() => controller.abort(new Error(`test mint request exceeded ${timeoutMs}ms`)), timeoutMs);
		try {
			return await fetchImpl(input, { ...init, signal: controller.signal, redirect: "error" });
		} finally {
			clearTimeout(timer);
			inherited?.removeEventListener("abort", forwardAbort);
		}
	}) as typeof fetch;
}
