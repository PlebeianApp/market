/**
 * Race a promise against a timeout. Rejects with a descriptive error if the
 * timeout fires first.
 *
 * Used throughout the app for relay connections, signer operations, and
 * publish calls where NDK (or the remote party) may never resolve.
 */
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined
	const timeoutPromise = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs)
	})
	try {
		return await Promise.race([promise, timeoutPromise])
	} finally {
		clearTimeout(timer)
	}
}
