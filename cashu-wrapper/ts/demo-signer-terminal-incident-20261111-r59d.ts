/** Exact, finite permit for the fresh R59d outbid-return request proven pre-effect. */
import { DemoSignerCachedRejection } from './demo-signer-pure-policy'

export const DEMO_TERMINAL_INCIDENT_TOMBSTONE_TABLE_20261111_R59D =
	'demo_signer_rpc_incident_rejections_20261111_r59d' as const
export const DEMO_TERMINAL_INCIDENT_TOMBSTONE_SCHEMA_20261111_R59D =
	'PLEBEIAN_TERMINAL_SIGNER_INCIDENT_REJECTION_20261111_R59D_V1' as const
export const DEMO_TERMINAL_INCIDENT_REJECTION_REASON_20261111_R59D =
	'TERMINAL_PRE_EFFECT_EXACT_REQUEST_20261111_R59D' as const
export const DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261111_R59D = JSON.stringify({
	error: `DEMO_SIGNER_LOCAL_REFUSAL:${DEMO_TERMINAL_INCIDENT_REJECTION_REASON_20261111_R59D}`,
})

export class DemoSignerTerminalIncidentCachedRejection20261111R59d extends DemoSignerCachedRejection {
	constructor() {
		super(DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261111_R59D)
		this.name = 'DemoSignerTerminalIncidentCachedRejection20261111R59d'
	}
}

export const DEMO_TERMINAL_INCIDENT_EVIDENCE_DIGEST_20261111_R59D =
	'a5983150da1cda562e697b8406857ced619362a70af1ffeb0a4ea9b03f1f1eef' as const
export const DEMO_TERMINAL_INCIDENT_OPERATION_ID_20261111_R59D =
	'213cb27b2f1650dfbf412b5c744978de15d00cf3137c1d18479f18bcec9f4920' as const

export interface DemoSignerTerminalIncidentPermit20261111R59dV1 {
	schema: typeof DEMO_TERMINAL_INCIDENT_TOMBSTONE_SCHEMA_20261111_R59D
	participantId: 1 | 2 | 3 | 4
	requestId: string
	requestDigest: string
	evidenceDigest: typeof DEMO_TERMINAL_INCIDENT_EVIDENCE_DIGEST_20261111_R59D
	reason: typeof DEMO_TERMINAL_INCIDENT_REJECTION_REASON_20261111_R59D
	rejectionStatus: 422
	rejectionBody: typeof DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261111_R59D
}

const REQUEST_IDS = [
	'fec4f9d557aff614073222cf6a8ad8917ab9de00b79dec2c5f1b6a81066ebf50',
	'59549593e9af0d690327d1e57d33fd8ab2b88c45ba2230d2f8fea2f35a52ad55',
	'4def2a34e10a51238b5d918d2d86ffdd3c6a846de72658a24a49cc122439e179',
	'85ec38855ef0ed5809a36bba598ca7d3e2643f0c09ec0de07c4289256adde3a2',
] as const
const REQUEST_DIGESTS = [
	'bfec873fcf5501193f02ed6836facbee6e89634db9c803cbfd78e3327ff41516',
	'2b3b50ff88e57a610ca118a454cbb71b40d46727f824fdbbe1d80bda1bd0b13f',
	'6182a3169238b0402c182a02038a505982538ff9f6665d97b705ab308b6971cf',
	'2a6eccb8ff95aa8e6da6c74e02963b4a47a0a95cf47dbaebae5aba90e9132fbd',
] as const

export function demoSignerTerminalIncidentPermit20261111R59d(
	participantId: 1 | 2 | 3 | 4,
): DemoSignerTerminalIncidentPermit20261111R59dV1 {
	return Object.freeze({
		schema: DEMO_TERMINAL_INCIDENT_TOMBSTONE_SCHEMA_20261111_R59D,
		participantId,
		requestId: REQUEST_IDS[participantId - 1],
		requestDigest: REQUEST_DIGESTS[participantId - 1],
		evidenceDigest: DEMO_TERMINAL_INCIDENT_EVIDENCE_DIGEST_20261111_R59D,
		reason: DEMO_TERMINAL_INCIDENT_REJECTION_REASON_20261111_R59D,
		rejectionStatus: 422,
		rejectionBody: DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261111_R59D,
	})
}

export const DEMO_TERMINAL_INCIDENT_TOMBSTONE_CREATE_SQL_20261111_R59D = `
	CREATE TABLE ${DEMO_TERMINAL_INCIDENT_TOMBSTONE_TABLE_20261111_R59D} (
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
