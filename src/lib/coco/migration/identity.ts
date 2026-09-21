import type { MigrationEnvironment, MigrationIdentity } from './model'
import { MigrationSafetyError } from './model'

const PUBKEY = /^[0-9a-f]{64}$/
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/
const UNIT = /^[a-z0-9][a-z0-9._-]{0,31}$/
export const COCO_V2_NAMESPACE_PREFIX = 'plebeian-market:coco:v2'

export function requireSafeId(value: unknown, field: string): string {
	if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new MigrationSafetyError('INVALID_INPUT', `${field} is invalid`)
	return value
}

export function normalizeAccount(value: unknown): string {
	if (typeof value !== 'string' || !PUBKEY.test(value.toLowerCase())) {
		throw new MigrationSafetyError('INVALID_INPUT', 'account must be a 64-character hex Nostr public key')
	}
	return value.toLowerCase()
}

export function normalizeEnvironment(value: unknown): MigrationEnvironment {
	if (value === 'development' || value === 'test' || value === 'staging' || value === 'production') return value
	throw new MigrationSafetyError('INVALID_INPUT', 'environment is invalid')
}

export function buildCanonicalWalletNamespace(input: { environment: MigrationEnvironment; account: string }): string {
	return `${COCO_V2_NAMESPACE_PREFIX}:${normalizeEnvironment(input.environment)}:nostr:${normalizeAccount(input.account)}`
}

export function parseCanonicalWalletNamespace(value: unknown): Readonly<{ environment: MigrationEnvironment; account: string }> {
	if (typeof value !== 'string') throw new MigrationSafetyError('INVALID_INPUT', 'wallet namespace must be a string')
	const parts = value.split(':')
	if (parts.length !== 6 || parts.slice(0, 3).join(':') !== COCO_V2_NAMESPACE_PREFIX || parts[4] !== 'nostr') {
		throw new MigrationSafetyError('INVALID_INPUT', 'wallet namespace is not canonical')
	}
	const parsed = Object.freeze({ environment: normalizeEnvironment(parts[3]), account: normalizeAccount(parts[5]) })
	if (buildCanonicalWalletNamespace(parsed) !== value) {
		throw new MigrationSafetyError('INVALID_INPUT', 'wallet namespace is not canonical')
	}
	return parsed
}

export function normalizeUnit(value: unknown): string {
	if (typeof value !== 'string') throw new MigrationSafetyError('INVALID_INPUT', 'unit must be a string')
	const normalized = value.toLowerCase()
	if (!UNIT.test(normalized)) throw new MigrationSafetyError('INVALID_INPUT', 'unit is invalid')
	return normalized
}

export function normalizeMintUrl(value: unknown): string {
	if (typeof value !== 'string' || value.length > 4096) throw new MigrationSafetyError('INVALID_INPUT', 'mint URL is invalid')
	const trimmed = value.trim()
	if (/%(?![0-9a-fA-F]{2})/.test(trimmed)) {
		throw new MigrationSafetyError('INVALID_INPUT', 'mint URL has malformed percent encoding')
	}
	let url: URL
	try {
		url = new URL(trimmed)
	} catch {
		throw new MigrationSafetyError('INVALID_INPUT', 'mint URL is invalid')
	}
	if (
		(url.protocol !== 'https:' && url.protocol !== 'http:') ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		/\/{2,}$/.test(url.pathname)
	) {
		throw new MigrationSafetyError('INVALID_INPUT', 'mint URL contains unsupported or ambiguous components')
	}
	url.pathname = url.pathname.replace(/%([0-9a-fA-F]{2})/g, (_match, hex: string) => {
		const character = String.fromCharCode(Number.parseInt(hex, 16))
		return /^[A-Za-z0-9._~-]$/.test(character) ? character : `%${hex.toUpperCase()}`
	})
	if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/$/, '')
	return url.toString().replace(/\/$/, '')
}

export function createMigrationIdentity(input: MigrationIdentity): Readonly<MigrationIdentity> {
	const account = normalizeAccount(input.account)
	const environment = normalizeEnvironment(input.environment)
	const namespace = requireSafeId(input.namespace, 'namespace')
	if (namespace !== buildCanonicalWalletNamespace({ environment, account })) {
		throw new MigrationSafetyError('IDENTITY_MISMATCH', 'wallet namespace does not match account and environment')
	}
	return Object.freeze({
		namespace,
		account,
		environment,
		epoch: requireSafeId(input.epoch, 'epoch'),
	})
}

export function assertSameIdentity(expected: MigrationIdentity, actual: MigrationIdentity): void {
	if (
		expected.namespace !== actual.namespace ||
		expected.account !== actual.account ||
		expected.environment !== actual.environment ||
		expected.epoch !== actual.epoch
	) {
		throw new MigrationSafetyError('IDENTITY_MISMATCH', 'migration identity does not match')
	}
}
