import { describe, expect, test } from 'bun:test'
import { getEncodedToken } from '@cashu/coco-core'
import {
	blindMessage, constructUnblindedSignature, createBlindSignature, createDLEQProof, pointFromHex,
} from '@cashu/cashu-ts'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import { createDemoFridayBrowserExactEnvelopeBuilder } from './demo-friday-browser-exact-envelope-builder'
import { createDemoFridayOperationBoundSigning, demoFridayBrowserPublicOperation } from './demo-friday-browser-coco-client'
import { createDemoFridayBrowserPaymentOperation } from './demo-friday-browser-payment-state'
import { verifyDemoFridayPreparedFundingEnvelope } from './demo-friday-prepared-funding'
import { buildDemoSigAllSecret, demoDenominationKeyDigest, demoOutputsDigest, demoRecipientCapabilityDigest } from './demo-sigall-settlement'
import { proofPoint } from './nut-client'
import { createDemoFridayPaymentSignerFromSecret } from './poc-demo-browser-signer'

const privateKey = (value: number) => hexToBytes(value.toString(16).padStart(64, '0'))
const compressed = (value: number) => bytesToHex(secp256k1.getPublicKey(privateKey(value), true))
const actorSecret = privateKey(1)
const actor = bytesToHex(schnorr.getPublicKey(actorSecret))
const mintUrl = 'https://172.105.64.142'

function signedEvent(unsigned: { pubkey: string; created_at: number; kind: number; tags: string[][]; content: string }) {
	const id = bytesToHex(sha256(utf8ToBytes(JSON.stringify([
		0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content,
	]))))
	return { ...structuredClone(unsigned), id, sig: bytesToHex(schnorr.sign(hexToBytes(id), actorSecret)) }
}

describe('Friday exact browser threshold envelope builder', () => {
	test('builds a fully verified V2 winner/refund bundle with one-shot role-bound signatures', async () => {
		let next = 5
		const mintSecrets = { '4': privateKey(24), '8': privateKey(25) }
		const denominationKeys = { '4': compressed(24), '8': compressed(25) }
		const operation = createDemoFridayBrowserPaymentOperation({
			actor, environmentId: 'friday-live', authNetworkId: 'friday-network', chainId: 'friday-chain',
			auctionId: 'auction-1', fundingOperationId: '4'.repeat(64), canonicalMintUrl: mintUrl,
			mintPublicKey: compressed(20), mintServerVersion: 'Nutshell/0.19.2', bidAmount: 12,
			fullPoolAmount: 12, reservedPoolAmount: 12, replacesBidId: '3'.repeat(64), priorLeaderActor: '2'.repeat(64),
			winnerRecipientPublicKey: compressed(4), winnerRecipientCapabilityDigest: '0'.repeat(64),
			winnerOutputsDigest: '0'.repeat(64), keysetId: '00deadbeefdeadbe',
			denominationKeyDigest: demoDenominationKeyDigest(denominationKeys),
			denominationAmounts: [4, 8], mintNuts: [4, 7, 9, 10, 11, 12], inputFeePpk: 0,
			committeePublicKey: compressed(21), committeeKeysetId: 'committee-1', committeeKeysetVersion: 'version-1',
			dkgRunId: 'dkg-1', publicKeyPackageSha256: '7'.repeat(64), signerRosterDigest: '8'.repeat(64),
			locktime: 10_000,
		}, (bytes) => { bytes.fill(0); bytes[31] = next++; return bytes })
		const outputs = (base: number) => [
			{ amount: 4, id: operation.keysetId, B_: compressed(base) },
			{ amount: 8, id: operation.keysetId, B_: compressed(base + 1) },
		]
		const request = (role: 'winner_settlement' | 'refund', recipientPublicKey: string, recipientSecret: Uint8Array,
			plannedOutputs: ReturnType<typeof outputs>) => {
			const capability = { schema: 'COCO_DEMO_RECIPIENT_CAPABILITY_V1' as const, network: operation.authNetworkId,
				chainId: operation.chainId, auctionId: operation.auctionId, operationId: operation.fundingOperationId,
				role, mintUrl, unit: 'sat', recipientPublicKey, outputsDigest: demoOutputsDigest(plannedOutputs), signature: '' }
			capability.signature = bytesToHex(schnorr.sign(hexToBytes(demoRecipientCapabilityDigest(capability)), recipientSecret))
			return { capability, outputs: plannedOutputs }
		}
		const winnerRequest = request('winner_settlement', compressed(4), privateKey(4), outputs(30))
		const refundSecret = hexToBytes(operation.refundSecret)
		const refundRequest = request('refund', operation.refundPublicKey, refundSecret, outputs(32))
		operation.winnerRecipientCapabilityDigest = demoRecipientCapabilityDigest(winnerRequest.capability)
		operation.winnerOutputsDigest = demoOutputsDigest(winnerRequest.outputs)
		const proofs = [4, 8].map((amount, index) => {
			const secret = buildDemoSigAllSecret({
				nonce: (index === 0 ? '9' : 'a').repeat(64), bidderPublicKey: operation.paymentPublicKey,
				committeePublicKey: operation.lock.committeePubkey, refundPublicKey: operation.refundPublicKey,
				locktime: operation.lock.locktime,
			})
			const mintSecret = mintSecrets[String(amount) as '4' | '8']
			const blinded = blindMessage(utf8ToBytes(secret), BigInt(index + 1))
			const signature = createBlindSignature(blinded.B_, mintSecret, operation.keysetId)
			const dleq = createDLEQProof(blinded.B_, mintSecret)
			const unblinded = constructUnblindedSignature(signature, blinded.r,
				utf8ToBytes(secret), pointFromHex(denominationKeys[String(amount) as '4' | '8']))
			return { amount, id: operation.keysetId, secret, C: unblinded.C.toHex(true),
				dleq: { e: bytesToHex(dleq.e), s: bytesToHex(dleq.s),
					r: blinded.r.toString(16).padStart(64, '0') } }
		}).sort((left, right) => bytesToHex(proofPoint(right).toBytes(true))
			.localeCompare(bytesToHex(proofPoint(left).toBytes(true))))
		const lockedToken = getEncodedToken({ mint: mintUrl, unit: 'sat', proofs } as never)
		const paymentSigner = createDemoFridayPaymentSignerFromSecret(hexToBytes(operation.paymentSecret))
		const refundSigner = createDemoFridayPaymentSignerFromSecret(refundSecret)
		try {
			const signing = createDemoFridayOperationBoundSigning({ operation, paymentSigner, refundSigner,
				nostrSigner: { async getPublicKey() { return actor }, async signEvent(unsigned) { return signedEvent(unsigned) } },
				lockedToken, winnerRequest, refundRequest })
			const builder = createDemoFridayBrowserExactEnvelopeBuilder({ participants: [1, 2, 3, 4].map((identifier) => ({
				identifier: identifier as 1 | 2 | 3 | 4, verifyingShare: compressed(50 + identifier),
			})) as never })
			const keyset = { id: operation.keysetId, unit: 'sat' as const, keys: denominationKeys }
			const refundDelivery = { intent: {
					schema: 'COCO_DEMO_RECIPIENT_INTENT_V1' as const, network: operation.authNetworkId, chainId: operation.chainId,
					auctionId: operation.auctionId, operationId: operation.fundingOperationId, role: 'refund' as const, mintUrl,
					unit: 'sat' as const, recipientPublicKey: operation.refundPublicKey, amounts: [4, 8],
				}, keyset }
			const buildInput = { operation: demoFridayBrowserPublicOperation(operation), keyset, winnerRequest,
				refundDelivery, refundRequest, signing, nowSeconds: 1_000 }
			const missingDleq = structuredClone(proofs).map(({ dleq: _dleq, ...proof }) => proof)
			await expect(builder.buildExact({ ...buildInput,
				lockedToken: getEncodedToken({ mint: mintUrl, unit: 'sat', proofs: missingDleq } as never),
			})).rejects.toThrow(/DLEQ is required/)
			const invalidDleq = structuredClone(proofs)
			invalidDleq[0]!.dleq.e = '0'.repeat(64)
			await expect(builder.buildExact({ ...buildInput,
				lockedToken: getEncodedToken({ mint: mintUrl, unit: 'sat', proofs: invalidDleq } as never),
			})).rejects.toThrow(/DLEQ\/keyset binding failed/)
			const built = await builder.buildExact({ ...buildInput, lockedToken })
			const verified = verifyDemoFridayPreparedFundingEnvelope(built.envelope, {
				authNetworkId: operation.authNetworkId, chainId: operation.chainId, mintUrl, nowSeconds: 1_000,
			})
			expect(verified.bundle.winner.schema).toBe('COCO_DEMO_MAINTAINER_EXACT_BRANCH_V2')
			expect(verified.bundle.winner.closeTime).toBe(9_100)
			expect(verified.bundle.refund.amount).toBe(12)
			expect(verified.bundle.refund.inputs.map((proof) => bytesToHex(proofPoint(proof).toBytes(true))))
				.toEqual([...verified.bundle.refund.inputs.map((proof) => bytesToHex(proofPoint(proof).toBytes(true)))].sort())
			expect(verified.authorization.content.fundingOperationId).toBe(operation.fundingOperationId)
		} finally { paymentSigner.dispose(); refundSigner.dispose(); refundSecret.fill(0) }
	})
})
