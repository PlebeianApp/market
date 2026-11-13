/** Exact, finite permit for the R62 winner request proven pre-effect. */
import { DemoSignerCachedRejection } from './demo-signer-pure-policy'

export const DEMO_TERMINAL_INCIDENT_TOMBSTONE_TABLE_20261111_R62 =
	'demo_signer_rpc_incident_rejections_20261111_r62' as const
export const DEMO_TERMINAL_INCIDENT_TOMBSTONE_SCHEMA_20261111_R62 =
	'PLEBEIAN_TERMINAL_SIGNER_INCIDENT_REJECTION_20261111_R62_V1' as const
export const DEMO_TERMINAL_INCIDENT_REJECTION_REASON_20261111_R62 =
	'TERMINAL_PRE_EFFECT_WINNER_POLICY_20261111_R62' as const
export const DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261111_R62 = JSON.stringify({
	error: `DEMO_SIGNER_LOCAL_REFUSAL:${DEMO_TERMINAL_INCIDENT_REJECTION_REASON_20261111_R62}`,
})

export class DemoSignerTerminalIncidentCachedRejection20261111R62 extends DemoSignerCachedRejection {
	constructor() {
		super(DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261111_R62)
		this.name = 'DemoSignerTerminalIncidentCachedRejection20261111R62'
	}
}

export const DEMO_TERMINAL_INCIDENT_EVIDENCE_DIGEST_20261111_R62 =
	'e09f9775dbc7177f260d154aaea0a82ee32f6a0d8663aba50c39b179fc43d604' as const
export const DEMO_TERMINAL_INCIDENT_OPERATION_ID_20261111_R62 =
	'd79c9bfa1de24bb1144c9aff45e41699a56d0a96f7ff742bcde4b6ddaa1f547c' as const

export interface DemoSignerTerminalIncidentPermit20261111R62V1 {
	schema: typeof DEMO_TERMINAL_INCIDENT_TOMBSTONE_SCHEMA_20261111_R62
	participantId: 1 | 2 | 3 | 4
	requestId: string
	requestDigest: string
	evidenceDigest: typeof DEMO_TERMINAL_INCIDENT_EVIDENCE_DIGEST_20261111_R62
	reason: typeof DEMO_TERMINAL_INCIDENT_REJECTION_REASON_20261111_R62
	rejectionStatus: 422
	rejectionBody: typeof DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261111_R62
}

const REQUEST_IDS = [
	'05fec9dd48c00bcb2d0479fa01e64fa81e015250de29bde431689138c681b631',
	'607ec082eaf52fd50bb71267bd978b06f528c24da278bc1c3c14a6e3ba21247e',
	'97a4addd3c5da16e2dde3ec530fde7ae65cce7cb5ebb15c9b46f47d722058912',
	'3ac99a124f7e54b4420c4a094b93c87cc6f4d9ad9f87b03269bf03629003f4bd',
] as const
const REQUEST_DIGESTS = [
	'f44398f0ad96e6dc328751ad59c1aa981165d8fc76b72ee1018a56cf7dca0844',
	'68099af6c46614c5c839cf3ff88ec0973c79e2de272f5c0308f3ee2c60241dbb',
	'd53bc9d2f7816afea7080b1cbecb830f0a05a0ea70fb46dcecc91ac9116608a4',
	'60decd946a28100012d27656fda67256f34b31f5bda85410854ee48c2a336401',
] as const

export function demoSignerTerminalIncidentPermit20261111R62(
	participantId: 1 | 2 | 3 | 4,
): DemoSignerTerminalIncidentPermit20261111R62V1 {
	return Object.freeze({
		schema: DEMO_TERMINAL_INCIDENT_TOMBSTONE_SCHEMA_20261111_R62,
		participantId,
		requestId: REQUEST_IDS[participantId - 1],
		requestDigest: REQUEST_DIGESTS[participantId - 1],
		evidenceDigest: DEMO_TERMINAL_INCIDENT_EVIDENCE_DIGEST_20261111_R62,
		reason: DEMO_TERMINAL_INCIDENT_REJECTION_REASON_20261111_R62,
		rejectionStatus: 422,
		rejectionBody: DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261111_R62,
	})
}

export const DEMO_TERMINAL_INCIDENT_TOMBSTONE_CREATE_SQL_20261111_R62 = `
	CREATE TABLE ${DEMO_TERMINAL_INCIDENT_TOMBSTONE_TABLE_20261111_R62} (
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
