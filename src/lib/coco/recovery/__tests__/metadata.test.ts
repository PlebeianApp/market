import { describe, expect, test } from 'bun:test'
import { assertMetadataOnly } from '../../migration'
import { IDENTITY, createReadyRecord } from '../../migration/__tests__/fixtures'
import {
	InMemoryRecoveryMetadataStore,
	createRecoveryMetadata,
	createRecoveryQuiescenceCertificate,
	verifyRecoveryQuiescenceCertificate,
} from '..'

const FINGERPRINT = `sha256:${'1'.repeat(64)}`

function validMetadata() {
	return {
		id: 'recovery-1',
		walletNamespace: IDENTITY.namespace,
		cocoOperationId: 'operation-1',
		derivationPurpose: 'auction-p2pk',
		derivationVersion: 1,
		derivationReference: 'm-44-0-1',
		publicKey: '02'.concat('2'.repeat(64)),
		auctionBinding: {
			auctionId: 'auction-1',
			bidEventId: 'bid-1',
			sellerPubkey: 'a'.repeat(64),
		},
		publicConditionFingerprint: FINGERPRINT,
		status: 'PENDING',
		updatedAtMs: 1,
	}
}

describe('recovery metadata boundary', () => {
	test('persists only public recovery metadata', async () => {
		const metadata = createRecoveryMetadata(validMetadata())
		const store = new InMemoryRecoveryMetadataStore()
		await store.put(metadata)
		expect(await store.get(metadata.walletNamespace, metadata.id)).toEqual(metadata)
		expect(await store.list(IDENTITY.namespace)).toHaveLength(1)
		const otherNamespace = `plebeian-market:coco:v2:production:nostr:${'b'.repeat(64)}`
		const other = createRecoveryMetadata({ ...validMetadata(), walletNamespace: otherNamespace })
		await store.put(other)
		expect(await store.get(IDENTITY.namespace, metadata.id)).toEqual(metadata)
		expect(await store.get(otherNamespace, other.id)).toEqual(other)
	})

	test.each(['seed', 'refundPrivateKey', 'sellerChildPrivateKey', 'proofs', 'witnesses', 'bearerToken'])(
		'rejects forbidden recovery material field %s',
		(field) => {
			expect(() => createRecoveryMetadata({ ...validMetadata(), [field]: 'secret-material' })).toThrow()
		},
	)

	test('migration persistence rejects nested private or bearer material', async () => {
		const ready = await createReadyRecord()
		expect(() => assertMetadataOnly(ready)).not.toThrow()
		expect(() => assertMetadataOnly({ ...ready, accidental: { proofs: ['bearer'] } })).toThrow()
		expect(() => assertMetadataOnly({ ...ready, accidental: { seed: 'plaintext' } })).toThrow()
		expect(() => assertMetadataOnly({ ...ready, accidentalBinary: new Uint8Array([1, 2, 3]) })).toThrow()
	})

	test('quiescence certificate is derived from operation states, not a caller success boolean', async () => {
		await expect(
			createRecoveryQuiescenceCertificate(
				IDENTITY,
				4,
				[{ operationId: 'recovery-op', status: 'PENDING', publicConditionFingerprint: FINGERPRINT }],
				'certificate-1',
			),
		).rejects.toMatchObject({ code: 'CUTOVER_BLOCKED' })
		const certificate = await createRecoveryQuiescenceCertificate(
			IDENTITY,
			4,
			[{ operationId: 'recovery-op', status: 'QUIESCENT', publicConditionFingerprint: FINGERPRINT }],
			'certificate-1',
			2,
		)
		expect(certificate.authorityGeneration).toBe(4)
		expect(certificate.commitment).toMatch(/^sha256:[0-9a-f]{64}$/)
		await expect(verifyRecoveryQuiescenceCertificate({ ...certificate, commitment: `sha256:${'0'.repeat(64)}` })).rejects.toMatchObject({
			code: 'INVALID_INPUT',
		})
	})
})
