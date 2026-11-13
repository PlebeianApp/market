/** Exact, finite permit for the R39 terminal request proven pre-effect by R4b. */
import { DemoSignerCachedRejection } from './demo-signer-pure-policy'

export const DEMO_TERMINAL_INCIDENT_TOMBSTONE_TABLE_20261109 =
	'demo_signer_rpc_incident_rejections_20261109' as const

export const DEMO_TERMINAL_INCIDENT_TOMBSTONE_SCHEMA_20261109 =
	'PLEBEIAN_TERMINAL_SIGNER_INCIDENT_REJECTION_20261109_V1' as const

export const DEMO_TERMINAL_INCIDENT_REJECTION_REASON_20261109 =
	'TERMINAL_PRE_EFFECT_EXACT_REQUEST' as const

export const DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261109 = JSON.stringify({
	error: `DEMO_SIGNER_LOCAL_REFUSAL:${DEMO_TERMINAL_INCIDENT_REJECTION_REASON_20261109}`,
})

export class DemoSignerTerminalIncidentCachedRejection20261109 extends DemoSignerCachedRejection {
	constructor() {
		super(DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261109)
		this.name = 'DemoSignerTerminalIncidentCachedRejection20261109'
	}
}

export const DEMO_TERMINAL_INCIDENT_EVIDENCE_DIGEST_20261109 =
	'3283fadcf131d7768e4268cbbffdf0a617903cfab26663eff2b78f0c046a8195' as const

export const DEMO_TERMINAL_INCIDENT_OPERATION_ID_20261109 =
	'cb969282f4294c28968cd6ee3ec5d9ef2f3525afd6b4d9c17afb9300b80087df' as const
export const DEMO_TERMINAL_INCIDENT_SESSION_ID_20261109 =
	'ca43f55f3bbb8a34d029dd7de76643defd03808cd80df3fe7324e3e0ef4990dd' as const
export const DEMO_TERMINAL_INCIDENT_OPERATION_FILE_20261109 =
	'fabc8c3723dfb5893c70339046901ab0763afb205b6d71b2a9cac901840e30b7.json' as const
export const DEMO_TERMINAL_INCIDENT_NONCE_JOURNAL_20261109 =
	'sign-23a8645dd0998951396ccc7380f75f9262c8b2f2a0e79347475a0b0c7df10703.journal' as const

const RECOVERY_BINDINGS = [
	{ restartEpoch: 7, complete: 42, dispositionRestartEpoch: 10, rustRevision: 100, rustDigest: 'aefbae618db8bb309c8b00b794b1b4e22b153ef0951918a774a6fe733d1f4902', journalGeneration: 'e56bdaf19de68079e9320fe2118108ff474636d068c7ed426ebf96baf11892d9', stateDirectoryIdentity: '414620afafddfcba231860e5387b84e541b97ca76a54567e81dce107dcae2c02', processIdentity: '7bbd6fefa289786174bfe6aaedd28b82dd53b22e36bc2ab6ad8bd874c7d30b63', verifyingShare: '0250791610f447a33def499e54806b912b15f8f48375ac3f60ee387081780d3d6c' },
	{ restartEpoch: 6, complete: 42, dispositionRestartEpoch: 9, rustRevision: 100, rustDigest: '08dd01904b3778b2d834b29d3ba9d202da4c76bb0d4dd81281a0ce4a2ab8000c', journalGeneration: 'a99815d6b48b93756351f13e0daf3a35c9395b51ec656cc84514535ffbcb16c6', stateDirectoryIdentity: 'e6a959daeb1458ade89a5d0ef1f13d1502ecc91f7d74a136d0efd25513ed4b13', processIdentity: '595a24ce72978be91ae993c96d28bfc12d6ccb94212599ff69f7d1371f9a6a91', verifyingShare: '03409e77a1a994d5d6e53dc5930f02a8adc149c11fb8d4a17c3982fddadd36c99c' },
	{ restartEpoch: 6, complete: 42, dispositionRestartEpoch: 9, rustRevision: 100, rustDigest: '69d5983a5d31e60773679d106f41f840d55910876edc22811eb05b39f591aba9', journalGeneration: '292f1a9fbe5dc9263074c7183cd402ace7c44063d65a81f328ebeebbc0332994', stateDirectoryIdentity: 'bea7c0cd9116feabebfaf2830bb1ccf00a91314ddcd566fad209340de10b57c5', processIdentity: '298da713895db65b5b860a11307a78ae8a3057daa7d938af60ca13e439a31b42', verifyingShare: '023df9e926330ef6972f5441702bc9a15ef1e7e11297e34ce23b24810ba4d7827a' },
	{ restartEpoch: 6, complete: 21, dispositionRestartEpoch: 8, rustRevision: 21, rustDigest: 'a94b40a4dc124cf08bca0dacc68b4ee5b7f5d77db6400bc794a15a8ef6b646a4', journalGeneration: 'e0f5591b2e0023c8262dae6d345fdec9753ffa42e1b725d7601bc90cb0dcb779', stateDirectoryIdentity: '1c97551766435590db9bd26e1fe0f862562d00da7d8eb8881e58d81f2aaed51d', processIdentity: 'bfa05c77a3f23666e3b586a8edca5e50aa6717c309132ed2f9bee93ac7fc3956', verifyingShare: '035be93ed5b6a233e7e045ebe0fa7f70ccbab6ef2c6f04b184a47d122c3ecdcd71' },
] as const

// The disposition anchor uses its own domain-separated directory identity and
// journal generation.  These are deliberately distinct from the signer-RPC
// binding above even though both describe the same on-disk state directory.
const DISPOSITION_BINDINGS = [
	{ stateDirectoryIdentity: 'd23452cdcf627f663fdda972a96990428c392ae4925bec0035d1561bb76d297a', journalGeneration: '734846d3b3fe6808d286de33f8d02f8c386fc196a0d542aaf5f3ae0fea62a23c' },
	{ stateDirectoryIdentity: '1f6531636df415aac28c48e8001245b704b1731256d2981bf8dc53644d0d05b5', journalGeneration: '4d974c465dff01419b3b18bd8ed41b4f0b0a19229263864e79602e232f0cae8a' },
	{ stateDirectoryIdentity: '5e24fb2ca945edd7260c1e2d02d9d21fc9c03852b8e6b312bbc15d8b4c933f43', journalGeneration: '13809159ab64bb51d4c4900f11e0f1b92f3520f67f0a5361d56ab88c5b34c157' },
	{ stateDirectoryIdentity: '98ff1009d1b3070e30b0f26532330fa5d6f500c2df1e5d3e2c4346484f57a491', journalGeneration: 'f20742f989c050d9aa152602a59551f07dcc99605f4669a2c1e42e64a386a8c4' },
] as const

export function demoSignerTerminalIncidentRecoveryBinding20261109(participantId: 1 | 2 | 3 | 4) {
	const value = {
		participantId,
		keysetId: 'friday-demo-frost-keyset-separated-v1', keysetVersion: '3',
		dkgRunId: 'friday-demo-20261030-separated-v1-dkg1',
		publicKeyPackageSha256: '954382a53b3589dc0b6069df298c803d2cebcfdec9502645f3c0264e668bdde5',
		signerRosterDigest: 'c1aca1467fa1485dadfb7260024adf31f23e2d0912c99569292ee920d6d1eea1',
		stateDirectory: '/var/lib/plebeian-auctions-friday/frost-v3/keyset-v3/state',
		proofRevision: 21,
		proofDigest: 'f1530d3b687039adf63e069876bda672dab6c7f14a783cca454b370a331309f2',
		...RECOVERY_BINDINGS[participantId - 1],
	}
	const disposition = DISPOSITION_BINDINGS[participantId - 1]
	return Object.freeze({
		...value,
		dispositionStateDirectoryIdentity: disposition.stateDirectoryIdentity,
		dispositionJournalGeneration: disposition.journalGeneration,
		dispositionStableIdentity: JSON.stringify({
			safetySchema: 2, schema: 'COCO_DEMO_DISPOSITION_SIGNER_BINDING_V1', participantId,
			dkgRunId: value.dkgRunId, publicKeyPackageSha256: value.publicKeyPackageSha256,
			signerRosterDigest: value.signerRosterDigest, stateDirectoryIdentity: disposition.stateDirectoryIdentity,
			journalGeneration: disposition.journalGeneration,
		}),
	})
}

export interface DemoSignerTerminalIncidentPermit20261109V1 {
	schema: typeof DEMO_TERMINAL_INCIDENT_TOMBSTONE_SCHEMA_20261109
	participantId: 1 | 2 | 3 | 4
	requestId: string
	requestDigest: string
	evidenceDigest: typeof DEMO_TERMINAL_INCIDENT_EVIDENCE_DIGEST_20261109
	reason: typeof DEMO_TERMINAL_INCIDENT_REJECTION_REASON_20261109
	rejectionStatus: 422
	rejectionBody: typeof DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261109
}

const REQUEST_IDS = [
	'eef1f1bdaebce623845603ab4c768995c517768d941c594153f930a1197a08e7',
	'17d413633fc81d7dba2c4696e7d7301767b07031d488e46cb621f0311abc3dd5',
	'a7a651890d9972529583797b674a786aa8f623932e68a8e89c7ce09e76ae0f9b',
	'6c1902490c5cfe2147e2a7515c20c12021f95d7771a1dae76878b677d88e6724',
] as const

const REQUEST_DIGESTS = [
	'8f528b0eb6b715e7812418494a68ef7c7e4b8cf97eb765755f1e92581c6ee17d',
	'dcd7f099e25cbbfb98c8ceeded80707e3f35b2fc5680dd27d9f0d12d9970fa28',
	'351ac50e3705f415a28d745b4cf242045b31f21d838f09902b85f4e302429e69',
	'f9fed77d179844de60d8c016c8852cbd19cc67ab5c5073facd9c9af10a30195c',
] as const

export function demoSignerTerminalIncidentPermit20261109(
	participantId: 1 | 2 | 3 | 4,
): DemoSignerTerminalIncidentPermit20261109V1 {
	return Object.freeze({
		schema: DEMO_TERMINAL_INCIDENT_TOMBSTONE_SCHEMA_20261109,
		participantId,
		requestId: REQUEST_IDS[participantId - 1],
		requestDigest: REQUEST_DIGESTS[participantId - 1],
		evidenceDigest: DEMO_TERMINAL_INCIDENT_EVIDENCE_DIGEST_20261109,
		reason: DEMO_TERMINAL_INCIDENT_REJECTION_REASON_20261109,
		rejectionStatus: 422,
		rejectionBody: DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261109,
	})
}

export const DEMO_TERMINAL_INCIDENT_TOMBSTONE_CREATE_SQL_20261109 = `
	CREATE TABLE ${DEMO_TERMINAL_INCIDENT_TOMBSTONE_TABLE_20261109} (
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
