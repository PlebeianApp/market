import { describe, expect, test } from 'bun:test'
import { getEncodedToken } from '@cashu/coco-core'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import {
	createDemoFridayOperationBoundSigning,
	demoFridayBrowserPublicOperation,
} from './demo-friday-browser-coco-client'
import { createDemoFridayBrowserPaymentOperation } from './demo-friday-browser-payment-state'
import { buildDemoSigAllSecret } from './demo-sigall-settlement'
import { createDemoFridayPaymentSignerFromSecret } from './poc-demo-browser-signer'

const scalar = (value: number) => value.toString(16).padStart(64, '0')
const compressed = (value: number) => bytesToHex(secp256k1.getPublicKey(hexToBytes(scalar(value)), true))

function fixture() {
	let next = 5
	const operation = createDemoFridayBrowserPaymentOperation({
		actor: '1'.repeat(64), environmentId: 'friday-live', authNetworkId: 'friday-network', chainId: 'friday-chain',
		auctionId: 'auction-1', fundingOperationId: 'operation-1', canonicalMintUrl: 'https://172.105.64.142',
		mintPublicKey: compressed(20), mintServerVersion: 'Nutshell/0.19.2', bidAmount: 12, fullPoolAmount: 12,
		reservedPoolAmount: 12, replacesBidId: '2'.repeat(64), priorLeaderActor: '3'.repeat(64),
		winnerRecipientPublicKey: compressed(4), winnerRecipientCapabilityDigest: '4'.repeat(64),
		winnerOutputsDigest: '5'.repeat(64), keysetId: '00deadbeefdeadbe', denominationKeyDigest: '6'.repeat(64),
		denominationAmounts: [4, 8], mintNuts: [4, 7, 9, 10, 11, 12], inputFeePpk: 0,
		committeePublicKey: compressed(21), committeeKeysetId: 'committee-1', committeeKeysetVersion: 'version-1',
		dkgRunId: 'dkg-1', publicKeyPackageSha256: '7'.repeat(64), signerRosterDigest: '8'.repeat(64), locktime: 10_000,
	}, (bytes) => { bytes.fill(0); bytes[31] = next++; return bytes })
	const proofSecret = buildDemoSigAllSecret({ nonce: '9'.repeat(64), bidderPublicKey: operation.paymentPublicKey,
		committeePublicKey: operation.lock.committeePubkey, refundPublicKey: operation.refundPublicKey,
		locktime: operation.lock.locktime })
	const lockedToken = getEncodedToken({ mint: operation.canonicalMintUrl, unit: 'sat', proofs: [{
		amount: 12, id: operation.keysetId, secret: proofSecret, C: compressed(22),
	}] } as never)
	const winnerOutputs = [{ amount: 12, id: operation.keysetId, B_: compressed(30) }]
	const refundOutputs = [{ amount: 12, id: operation.keysetId, B_: compressed(31) }]
	const recipientRequest = (outputs: typeof winnerOutputs) => ({ capability: {
		schema: 'COCO_DEMO_RECIPIENT_CAPABILITY_V1' as const, network: operation.authNetworkId,
		chainId: operation.chainId, auctionId: operation.auctionId, operationId: operation.fundingOperationId,
		role: 'winner_settlement' as const, mintUrl: operation.canonicalMintUrl, unit: 'sat',
		recipientPublicKey: compressed(4), outputsDigest: 'a'.repeat(64), signature: 'b'.repeat(128),
	}, outputs })
	const paymentSigner = createDemoFridayPaymentSignerFromSecret(hexToBytes(operation.paymentSecret))
	const refundSigner = createDemoFridayPaymentSignerFromSecret(hexToBytes(operation.refundSecret))
	const signing = () => createDemoFridayOperationBoundSigning({ operation, paymentSigner, refundSigner,
		nostrSigner: { async getPublicKey() { return operation.actor }, async signEvent() { throw new Error('unused') } },
		lockedToken, winnerRequest: recipientRequest(winnerOutputs), refundRequest: recipientRequest(refundOutputs),
	})
	return { operation, proofSecret, winnerOutputs, refundOutputs, signing, paymentSigner, refundSigner }
}

describe('Friday operation-bound signing capabilities', () => {
	test('redacts persisted secrets and rejects changed input, output, operation, or repeated use', async () => {
		const value = fixture()
		const publicValue = JSON.stringify(demoFridayBrowserPublicOperation(value.operation))
		expect(publicValue).not.toContain(value.operation.paymentSecret)
		expect(publicValue).not.toContain(value.operation.refundSecret)

		const exact = value.signing()
		await expect(exact.signCashuPackage({ operationId: value.operation.fundingOperationId,
			role: 'winner_settlement', authority: 'payment', inputs: [{ secret: value.proofSecret }],
			outputs: value.winnerOutputs.map(({ B_ }) => ({ B_ })) })).resolves.toMatchObject({
				digest: expect.stringMatching(/^[0-9a-f]{64}$/), signature: expect.stringMatching(/^[0-9a-f]{128}$/),
			})
		await expect(exact.signCashuPackage({ operationId: value.operation.fundingOperationId,
			role: 'winner_settlement', authority: 'payment', inputs: [{ secret: value.proofSecret }],
			outputs: value.winnerOutputs.map(({ B_ }) => ({ B_ })) })).rejects.toThrow(/twice/)

		for (const changed of [
			{ operationId: value.operation.fundingOperationId, role: 'winner_settlement' as const, authority: 'payment' as const,
				inputs: [{ secret: `${value.proofSecret}x` }], outputs: value.winnerOutputs.map(({ B_ }) => ({ B_ })) },
			{ operationId: value.operation.fundingOperationId, role: 'winner_settlement' as const, authority: 'payment' as const,
				inputs: [{ secret: value.proofSecret }], outputs: [{ B_: compressed(32) }] },
			{ operationId: 'another-operation', role: 'refund' as const, authority: 'refund' as const,
				inputs: [{ secret: value.proofSecret }], outputs: value.refundOutputs.map(({ B_ }) => ({ B_ })) },
		]) await expect(value.signing().signCashuPackage(changed)).rejects.toThrow(/outside its role and operation/)
		value.paymentSigner.dispose(); value.refundSigner.dispose()
	})
})
