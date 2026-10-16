import { ValidationError } from './errors'
import { failure, success, type Result } from './result'

/** Contract version of the host's public `/api/config` response. Bump on breaking shape changes. */
export const PUBLIC_CONFIG_SCHEMA_VERSION = 'public-config-v1'
export type PublicConfigSchemaVersion = typeof PUBLIC_CONFIG_SCHEMA_VERSION

export interface PublicConfigEnvelope {
	schemaVersion: PublicConfigSchemaVersion
	appRelay: string
	appPublicKey: string
	stage: 'production' | 'staging' | 'development'
}

const STAGES = new Set(['production', 'staging', 'development'])

/**
 * Checks the version and the fields every client needs before trusting the rest of the payload.
 * A missing version is accepted as v1 so clients keep working against hosts deployed before versioning.
 */
export function parsePublicConfigEnvelope<Config extends object>(input: unknown): Result<Config & PublicConfigEnvelope, ValidationError> {
	if (typeof input !== 'object' || input === null || Array.isArray(input)) {
		return failure(new ValidationError('Public config must be an object'))
	}
	const record = input as Record<string, unknown>
	const version = record.schemaVersion ?? PUBLIC_CONFIG_SCHEMA_VERSION
	if (version !== PUBLIC_CONFIG_SCHEMA_VERSION) {
		return failure(new ValidationError(`Unsupported public config schemaVersion: ${String(version)}`, ['schemaVersion']))
	}
	if (typeof record.appRelay !== 'string' || !/^wss?:\/\//i.test(record.appRelay)) {
		return failure(new ValidationError('appRelay must be a ws or wss URL', ['appRelay']))
	}
	if (typeof record.appPublicKey !== 'string' || !/^[0-9a-f]{64}$/i.test(record.appPublicKey)) {
		return failure(new ValidationError('appPublicKey must be a 64-character hex pubkey', ['appPublicKey']))
	}
	if (typeof record.stage !== 'string' || !STAGES.has(record.stage)) {
		return failure(new ValidationError('stage must be production, staging, or development', ['stage']))
	}
	return success({ ...(record as Config), schemaVersion: PUBLIC_CONFIG_SCHEMA_VERSION } as Config & PublicConfigEnvelope)
}
