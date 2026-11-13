/** Exact, finite permit for the R53 winner request proven pre-effect. */
import { DemoSignerCachedRejection } from './demo-signer-pure-policy'

export const DEMO_TERMINAL_INCIDENT_TOMBSTONE_TABLE_20261110 =
	'demo_signer_rpc_incident_rejections_20261110' as const
export const DEMO_TERMINAL_INCIDENT_TOMBSTONE_SCHEMA_20261110 =
	'PLEBEIAN_TERMINAL_SIGNER_INCIDENT_REJECTION_20261110_V1' as const
export const DEMO_TERMINAL_INCIDENT_REJECTION_REASON_20261110 =
	'TERMINAL_PRE_EFFECT_EXACT_REQUEST_20261110' as const
export const DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261110 = JSON.stringify({
	error: `DEMO_SIGNER_LOCAL_REFUSAL:${DEMO_TERMINAL_INCIDENT_REJECTION_REASON_20261110}`,
})

export class DemoSignerTerminalIncidentCachedRejection20261110 extends DemoSignerCachedRejection {
	constructor() {
		super(DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261110)
		this.name = 'DemoSignerTerminalIncidentCachedRejection20261110'
	}
}

export const DEMO_TERMINAL_INCIDENT_EVIDENCE_DIGEST_20261110 =
	'2412a2072bfed4a3fcf84f01a7188669e6435be53fe5c81c65ac68c1e90d1bf8' as const
export const DEMO_TERMINAL_INCIDENT_OPERATION_ID_20261110 =
	'3cdd3f019f43fc9aa1786f363818e9f21847405fbdfe47f578f8a3e6e385c97b' as const

export interface DemoSignerTerminalIncidentPermit20261110V1 {
	schema: typeof DEMO_TERMINAL_INCIDENT_TOMBSTONE_SCHEMA_20261110
	participantId: 1 | 2 | 3 | 4
	requestId: string
	requestDigest: string
	evidenceDigest: typeof DEMO_TERMINAL_INCIDENT_EVIDENCE_DIGEST_20261110
	reason: typeof DEMO_TERMINAL_INCIDENT_REJECTION_REASON_20261110
	rejectionStatus: 422
	rejectionBody: typeof DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261110
}

const REQUEST_IDS = [
	'b9ed3c1bbe8acdedbf32f767bfc2b0df56be45dff4d8b531fbc194763719acbe',
	'cd7c3a6c893ceb0f84fc39a8966d7866efd38d49d9b4813f6d3671943adadec0',
	'fb2fa79a3b60d1f79d202e93ea57b46eec8b7479d9709985da1a32ec0e30c1e2',
	'c71815b5b0839b9ea9b837023052fcf11950aa5c5d8c7ca1ff21d0413f6cb7a8',
] as const
const REQUEST_DIGESTS = [
	'2d91c53cb6353c12a52ade44ceea0d691b8609f7c9b64ba1e5179b9614be764f',
	'3ed097662eaaa12b17d4b47dbbba9880e94b6d7653746bc15cff3a64d83cf00c',
	'f21d90a3384c21796b67b3a0ef23d6bc6ebace7e77cd7f8cb657a8234f0ca60d',
	'26e7f9518fe92eaec29948111f609ad8ed3c914099bac3c621d07e6742b6449e',
] as const

export function demoSignerTerminalIncidentPermit20261110(
	participantId: 1 | 2 | 3 | 4,
): DemoSignerTerminalIncidentPermit20261110V1 {
	return Object.freeze({
		schema: DEMO_TERMINAL_INCIDENT_TOMBSTONE_SCHEMA_20261110,
		participantId,
		requestId: REQUEST_IDS[participantId - 1],
		requestDigest: REQUEST_DIGESTS[participantId - 1],
		evidenceDigest: DEMO_TERMINAL_INCIDENT_EVIDENCE_DIGEST_20261110,
		reason: DEMO_TERMINAL_INCIDENT_REJECTION_REASON_20261110,
		rejectionStatus: 422,
		rejectionBody: DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261110,
	})
}

export const DEMO_TERMINAL_INCIDENT_TOMBSTONE_CREATE_SQL_20261110 = `
	CREATE TABLE ${DEMO_TERMINAL_INCIDENT_TOMBSTONE_TABLE_20261110} (
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
