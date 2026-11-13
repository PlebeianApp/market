import type { ExtensionLogFields, ExtensionLogger } from '@sdk/core/extensions'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogSink = (level: LogLevel, message: string, fields?: Record<string, unknown>) => void

export const REDACTED = '[redacted]'
const MIN_SECRET_LENGTH = 4
const MAX_FIELD_DEPTH = 5

const consoleSink: LogSink = (level, message, fields) => {
	const write = level === 'debug' ? console.debug : level === 'info' ? console.info : level === 'warn' ? console.warn : console.error
	if (fields) write(message, fields)
	else write(message)
}

/** Every string leaf of a private config object; these are the values a logger must never write. */
export function collectSecretValues(privateConfig: unknown): string[] {
	const secrets = new Set<string>()
	const visit = (value: unknown, depth: number) => {
		if (depth > MAX_FIELD_DEPTH) return
		if (typeof value === 'string') {
			if (value.length >= MIN_SECRET_LENGTH) secrets.add(value)
		} else if (Array.isArray(value)) value.forEach((item) => visit(item, depth + 1))
		else if (value && typeof value === 'object') Object.values(value).forEach((item) => visit(item, depth + 1))
	}
	visit(privateConfig, 0)
	// Longest first so a secret containing another secret is fully redacted.
	return [...secrets].sort((a, b) => b.length - a.length)
}

export function redactText(text: string, secrets: readonly string[]): string {
	let result = text
	for (const secret of secrets) result = result.split(secret).join(REDACTED)
	return result
}

/** Logger scoped to one extension; messages and fields are redacted before reaching the sink. */
export function createRedactingLogger(extensionId: string, privateConfig: unknown, sink: LogSink = consoleSink): ExtensionLogger {
	const secrets = collectSecretValues(privateConfig)
	const write = (level: LogLevel) => (message: string, fields?: ExtensionLogFields) => {
		const safeMessage = `[extension:${extensionId}] ${redactText(String(message), secrets)}`
		sink(level, safeMessage, fields ? (redactValue(fields, secrets, 0) as Record<string, unknown>) : undefined)
	}
	return { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') }
}

function redactValue(value: unknown, secrets: readonly string[], depth: number): unknown {
	if (typeof value === 'string') return redactText(value, secrets)
	if (depth >= MAX_FIELD_DEPTH) return '[truncated]'
	if (value instanceof Error) return { name: value.name, message: redactText(value.message, secrets) }
	if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets, depth + 1))
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item, secrets, depth + 1)]))
	}
	return value
}
