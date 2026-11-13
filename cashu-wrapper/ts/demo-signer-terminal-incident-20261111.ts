/** Exact, finite permit for the 2026-11-11 winner request proven pre-effect. */
import { DemoSignerCachedRejection } from './demo-signer-pure-policy'

export const DEMO_TERMINAL_INCIDENT_TOMBSTONE_TABLE_20261111 =
	'demo_signer_rpc_incident_rejections_20261111' as const
export const DEMO_TERMINAL_INCIDENT_TOMBSTONE_SCHEMA_20261111 =
	'PLEBEIAN_TERMINAL_SIGNER_INCIDENT_REJECTION_20261111_V1' as const
export const DEMO_TERMINAL_INCIDENT_REJECTION_REASON_20261111 =
	'TERMINAL_PRE_EFFECT_EXACT_REQUEST_20261111' as const
export const DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261111 = JSON.stringify({
	error: `DEMO_SIGNER_LOCAL_REFUSAL:${DEMO_TERMINAL_INCIDENT_REJECTION_REASON_20261111}`,
})

export class DemoSignerTerminalIncidentCachedRejection20261111 extends DemoSignerCachedRejection {
	constructor() {
		super(DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261111)
		this.name = 'DemoSignerTerminalIncidentCachedRejection20261111'
	}
}

export const DEMO_TERMINAL_INCIDENT_EVIDENCE_DIGEST_20261111 =
	'6f59b6331cc876dad1bae444e969c8215d5fe66fbb531881c750ab65449cfbce' as const
export const DEMO_TERMINAL_INCIDENT_OPERATION_ID_20261111 =
	'3d19efb526a210cea553cb1aa0274b8190010aa873e9ff1158ae1f4d66fa0fcf' as const

export interface DemoSignerTerminalIncidentPermit20261111V1 {
	schema: typeof DEMO_TERMINAL_INCIDENT_TOMBSTONE_SCHEMA_20261111
	participantId: 1 | 2 | 3 | 4
	requestId: string
	requestDigest: string
	evidenceDigest: typeof DEMO_TERMINAL_INCIDENT_EVIDENCE_DIGEST_20261111
	reason: typeof DEMO_TERMINAL_INCIDENT_REJECTION_REASON_20261111
	rejectionStatus: 422
	rejectionBody: typeof DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261111
}

const REQUEST_IDS = [
	'cfc9d9c6cac640c312586256357ca1f6d6a8977ed55f962c20ee0693b4931cfa',
	'8079f740519869d62820cd1e0069da1a7fe4a4f57ba7c64da6f459043a3a5cd1',
	'852799d3cb38f03273962810b65b2c64310c9cb9dfd4f4f80d36294e424579b7',
	'32b821e536ebe0d4e47bc457fd971c685ec4203385642ae9d777250d6ce8a30c',
] as const
const REQUEST_DIGESTS = [
	'6f8ea3a74acd46f124aca6e1f1597347a3de2c0e3b0cd84caea19f8fc3b02b27',
	'e8843599501dbe558ab2efe45dbf499a14da585895dfa1fa4ea3f291e2fe0735',
	'845a124befa37715784983bb346a1c95844c140f2e83d50652740bd7764c4a2c',
	'50c52d391bbfbf1a3e8dc357e95bf35a1d19f22df2d3a2e1378c686cbb8d4195',
] as const

export function demoSignerTerminalIncidentPermit20261111(
	participantId: 1 | 2 | 3 | 4,
): DemoSignerTerminalIncidentPermit20261111V1 {
	return Object.freeze({
		schema: DEMO_TERMINAL_INCIDENT_TOMBSTONE_SCHEMA_20261111,
		participantId,
		requestId: REQUEST_IDS[participantId - 1],
		requestDigest: REQUEST_DIGESTS[participantId - 1],
		evidenceDigest: DEMO_TERMINAL_INCIDENT_EVIDENCE_DIGEST_20261111,
		reason: DEMO_TERMINAL_INCIDENT_REJECTION_REASON_20261111,
		rejectionStatus: 422,
		rejectionBody: DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261111,
	})
}

export const DEMO_TERMINAL_INCIDENT_TOMBSTONE_CREATE_SQL_20261111 = `
	CREATE TABLE ${DEMO_TERMINAL_INCIDENT_TOMBSTONE_TABLE_20261111} (
		schema TEXT NOT NULL,
		participant_id INTEGER PRIMARY KEY NOT NULL CHECK(participant_id BETWEEN 1 AND 4),
		request_id TEXT UNIQUE NOT NULL,
		request_digest TEXT NOT NULL,
		evidence_digest TEXT NOT NULL,
		reason TEXT NOT NULL,
		rejection_status INTEGER NOT NULL CHECK(rejection_status = 422),
		rejection_body TEXT NOT NULL
	) STRICT;
`
