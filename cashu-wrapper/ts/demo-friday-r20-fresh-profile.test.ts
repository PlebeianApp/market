import { describe, expect, test } from 'bun:test'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	DEMO_FRIDAY_DKG_MANIFEST_SCHEMA, demoFridayDkgManifestDigest, demoFridayDkgRosterDigest,
	exactDemoFridayDkgManifest, type DemoFridayDkgManifestParticipantV1,
} from './demo-friday-per-validator-dkg-bootstrap'
import {
	DEMO_FRIDAY_R18_ABORT_ACK_SCHEMA, DEMO_FRIDAY_R18_ABORT_RECORD_SCHEMA,
	DEMO_FRIDAY_R20_COORDINATOR_ROOT, DEMO_FRIDAY_R20_DKG_RUN_ID,
	DEMO_FRIDAY_R20_KEYSET_ID, DEMO_FRIDAY_R20_KEYSET_ROOT,
	assertDemoFridayR20BoundRecord, demoFridayR18AbortAcknowledgementDigest,
	demoFridayR18AbortDigest, exactDemoFridayR18AbortRecord, verifyDemoFridayR20FreshDkgProfile,
} from './demo-friday-r20-fresh-profile'

const privateKeys = [1, 2, 3, 4].map((value) => hexToBytes(value.toString(16).padStart(64, '0')))
const fipsNpubs = [
	'npub1tdcsm26d34sd7tlwmqypc2ctd8hjvpqzwaeechr688ah42mypg0sxga6nj',
	'npub10jac6jktr07h90d4txuer4xpu9taxfq458c0yr0enqcg2l798fps0pzlty',
	'npub1698v40hxh2y8denwrygl46m9m78ayf8p8277f4murx2u3gzqrjxqdytc6r',
	'npub14k9gzekwy6gt3vewmazawspxf84fhz94mjmfpqwspyaq5fwa2axsa7s2uc',
] as const

function hex(label: string): string { return bytesToHex(sha256(utf8ToBytes(label))) }

function fixture() {
	const participants = privateKeys.map((secret, index) => {
		const participantId = (index + 1) as 1 | 2 | 3 | 4
		const fipsUla = `fd00::${participantId}`
		return {
			participantId, hostId: `linode-${100000 + participantId}`, underlayIpv4: `198.18.1.${participantId}`,
			fipsNpub: fipsNpubs[index]!, fipsUla, dkgIdentity: bytesToHex(schnorr.getPublicKey(secret)),
			signerIdentity: bytesToHex(schnorr.getPublicKey(hexToBytes((participantId + 10).toString(16).padStart(64, '0')))),
			kexPublicKey: hex(`kex-${participantId}`), signerEndpoint: `http://[${fipsUla}]:39101/v1/frost`,
			participantBinarySha256: hex('participant'), inspectorBinarySha256: hex('inspector'),
			configPath: '/var/lib/plebeian-auctions-friday/frost/keyset-v1/participant.config.json',
			stateDirectory: '/var/lib/plebeian-auctions-friday/frost/keyset-v1/state',
		} satisfies DemoFridayDkgManifestParticipantV1
	}) as [DemoFridayDkgManifestParticipantV1, DemoFridayDkgManifestParticipantV1,
		DemoFridayDkgManifestParticipantV1, DemoFridayDkgManifestParticipantV1]
	const manifest = exactDemoFridayDkgManifest({
		schema: DEMO_FRIDAY_DKG_MANIFEST_SCHEMA, valueProfile: 'FAKE_MONEY_ONLY',
		deploymentId: 'friday-demo-r18', applicationRunId: 'friday-demo-r18-run1',
		dkgRunId: 'friday-demo-r18-dkg1', committeeKeysetId: 'friday-demo-frost-keyset-v1',
		committeeKeysetVersion: '1', roster: [1, 2, 3, 4], rosterDigest: demoFridayDkgRosterDigest(participants),
		coordinatorParticipantId: 1, coordinatorIdentity: hex('coordinator'), participants,
	})
	const record = exactDemoFridayR18AbortRecord({ predecessorManifest: manifest, record: {
		schema: DEMO_FRIDAY_R18_ABORT_RECORD_SCHEMA, valueProfile: 'FAKE_MONEY_ONLY',
		predecessorManifestDigest: demoFridayDkgManifestDigest(manifest),
		predecessorDeploymentId: manifest.deploymentId,
		predecessorApplicationRunId: manifest.applicationRunId,
		predecessorDkgRunId: manifest.dkgRunId,
		predecessorCommitteeKeysetId: manifest.committeeKeysetId,
		predecessorCommitteeKeysetVersion: manifest.committeeKeysetVersion,
		persistTransportReceiptDigests: [hex('receipt-1'), hex('receipt-2'), hex('receipt-3'), hex('receipt-4')],
		slot1DeadProcessIdentityDigest: hex('dead-process'), slot1LockMetadataDigest: hex('lock'),
		slot1JournalMetadataDigest: hex('journal'), slot1StateObservationDigest: hex('state'),
		serviceSealDigest: hex('seal'), abortReason: 'ROUND1_OUTCOME_INDETERMINATE',
	} })
	const abortDigest = demoFridayR18AbortDigest(record)
	const acknowledgements = participants.map((participant, index) => {
		const participantId = (index + 1) as 1 | 2 | 3 | 4
		const acknowledgementDigest = demoFridayR18AbortAcknowledgementDigest({
			abortDigest, participantId, dkgIdentity: participant.dkgIdentity,
		})
		return { schema: DEMO_FRIDAY_R18_ABORT_ACK_SCHEMA, abortDigest, participantId,
			dkgIdentity: participant.dkgIdentity,
			signature: bytesToHex(schnorr.sign(hexToBytes(acknowledgementDigest), privateKeys[index]!)) }
	})
	return { manifest, record, abortDigest, acknowledgements }
}

function binding(profile: ReturnType<typeof verifyDemoFridayR20FreshDkgProfile>) {
	return {
		deploymentId: profile.deploymentId, applicationRunId: profile.applicationRunId,
		dkgRunId: profile.dkgRunId, committeeKeysetId: profile.committeeKeysetId,
		committeeKeysetVersion: profile.committeeKeysetVersion, keysetRoot: profile.keysetRoot,
		coordinatorRoot: profile.coordinatorRoot, predecessorManifestDigest: profile.predecessorManifestDigest,
		predecessorAbortDigest: profile.predecessorAbortDigest,
		abortAcknowledgementsDigest: profile.abortAcknowledgementsDigest,
	}
}

describe('Friday R20 fresh DKG profile', () => {
	test('accepts exactly four predecessor acknowledgements and fixes all new roots', () => {
		const value = fixture()
		const profile = verifyDemoFridayR20FreshDkgProfile({
			predecessorManifest: value.manifest, abortRecord: value.record,
			acknowledgements: value.acknowledgements, expectedPredecessorAbortDigest: value.abortDigest,
		})
		expect(profile.dkgRunId).toBe(DEMO_FRIDAY_R20_DKG_RUN_ID)
		expect(profile.committeeKeysetId).toBe(DEMO_FRIDAY_R20_KEYSET_ID)
		expect(profile.keysetRoot).toBe(DEMO_FRIDAY_R20_KEYSET_ROOT)
		expect(profile.coordinatorRoot).toBe(DEMO_FRIDAY_R20_COORDINATOR_ROOT)
		expect(profile.configPath).toBe(`${DEMO_FRIDAY_R20_KEYSET_ROOT}/participant.config.json`)
		expect(profile.exchangeDirectory).toBe(`${DEMO_FRIDAY_R20_KEYSET_ROOT}/exchange/${DEMO_FRIDAY_R20_DKG_RUN_ID}`)
		for (const kind of ['host-pin', 'coordinator', 'manifest'] as const) {
			expect(() => assertDemoFridayR20BoundRecord({ profile, value: binding(profile), kind })).not.toThrow()
		}
	})

	test('rejects missing, reordered, mutated, or wrong-run acknowledgements and abort pins', () => {
		const value = fixture()
		const verify = (changes: Record<string, unknown> = {}) => verifyDemoFridayR20FreshDkgProfile({
			predecessorManifest: value.manifest, abortRecord: value.record,
			acknowledgements: value.acknowledgements, expectedPredecessorAbortDigest: value.abortDigest, ...changes,
		})
		expect(() => verify({ acknowledgements: value.acknowledgements.slice(0, 3) })).toThrow()
		expect(() => verify({ acknowledgements: [value.acknowledgements[1], value.acknowledgements[0],
			value.acknowledgements[2], value.acknowledgements[3]] })).toThrow()
		const mutated = structuredClone(value.acknowledgements)
		mutated[0]!.abortDigest = hex('other-abort')
		expect(() => verify({ acknowledgements: mutated })).toThrow()
		expect(() => verify({ expectedPredecessorAbortDigest: hex('owner-pin') })).toThrow()
		const otherManifest = structuredClone(value.manifest)
		otherManifest.dkgRunId = 'other-run'
		expect(() => verify({ predecessorManifest: otherManifest })).toThrow()
	})

	test('rejects v1 paths and any missing predecessor binding in downstream records', () => {
		const value = fixture()
		const profile = verifyDemoFridayR20FreshDkgProfile({
			predecessorManifest: value.manifest, abortRecord: value.record,
			acknowledgements: value.acknowledgements, expectedPredecessorAbortDigest: value.abortDigest,
		})
		const valid = binding(profile)
		expect(() => assertDemoFridayR20BoundRecord({ profile, kind: 'host-pin',
			value: { ...valid, keysetRoot: '/var/lib/plebeian-auctions-friday/frost/keyset-v1' } })).toThrow()
		expect(() => assertDemoFridayR20BoundRecord({ profile, kind: 'coordinator',
			value: { ...valid, coordinatorRoot: '/var/lib/plebeian-auctions-friday/coordinator' } })).toThrow()
		const withoutAbort = structuredClone(valid) as Record<string, unknown>
		delete withoutAbort.predecessorAbortDigest
		expect(() => assertDemoFridayR20BoundRecord({ profile, kind: 'manifest', value: withoutAbort })).toThrow()
	})
})
