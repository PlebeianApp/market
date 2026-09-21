import { MigrationSafetyError } from './model'

function canonicalize(value: unknown): string {
	if (value === null) return 'null'
	if (typeof value === 'bigint') return JSON.stringify(`${value.toString()}n`)
	if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value)) throw new MigrationSafetyError('INVALID_INPUT', 'commitment numbers must be safe integers')
		return String(value)
	}
	if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
	if (typeof value === 'object') {
		const object = value as Record<string, unknown>
		return `{${Object.keys(object)
			.sort()
			.filter((key) => object[key] !== undefined)
			.map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`)
			.join(',')}}`
	}
	throw new MigrationSafetyError('INVALID_INPUT', 'value cannot be committed')
}

export async function createCommitment(domain: string, value: unknown): Promise<string> {
	const bytes = new TextEncoder().encode(`${domain}\n${canonicalize(value)}`)
	const digest = await crypto.subtle.digest('SHA-256', bytes)
	return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
