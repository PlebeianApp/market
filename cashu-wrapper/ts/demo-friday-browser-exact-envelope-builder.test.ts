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
import {
	prepareDemoFridayAuctionPayoutAuthorization,
	selectDemoFridayAuctionPayout,
} from './demo-friday-auction-payout-authorization'
import type { DemoFridaySellerOpeningRefV1 } from './demo-friday-browser-coco-seller-plan'
import { verifyDemoFridayPreparedFundingEnvelope } from './demo-friday-prepared-funding'
import { validateDemoIntegratedAdmission } from './demo-integrated-admission-policy'
import {
	prepareDemoIntegratedFundingReceiptV4,
	type DemoIntegratedFundingReceiptV4Terms,
} from './demo-integrated-funding-receipt-v4'
import type { DemoRecipientPrivateRecord } from './demo-sigall-recipient'
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
	test('builds verified V2 and seller-offline V3 bundles with participant-local seller binding', async () => {
		let next = 5
		const mintSecrets = { '4': privateKey(24), '8': privateKey(25) }
		const denominationKeys = {
			'1': compressed(22), '2': compressed(23), '4': compressed(24), '8': compressed(25),
		}
		const operation = createDemoFridayBrowserPaymentOperation({
			actor, environmentId: 'friday-live', authNetworkId: 'friday-network', chainId: 'friday-chain',
			auctionId: 'auction-1', fundingOperationId: '4'.repeat(64), canonicalMintUrl: mintUrl,
			mintPublicKey: compressed(20), mintServerVersion: 'Nutshell/0.19.2', bidAmount: 12,
			fullPoolAmount: 12, reservedPoolAmount: 12, replacesBidId: '3'.repeat(64), priorLeaderActor: '2'.repeat(64),
			winnerRecipientPublicKey: compressed(4), winnerRecipientCapabilityDigest: '0'.repeat(64),
			winnerOutputsDigest: '0'.repeat(64), keysetId: '00deadbeefdeadbe',
			denominationKeyDigest: demoDenominationKeyDigest(denominationKeys),
			denominationAmounts: [1, 2, 4, 8], mintNuts: [4, 7, 9, 10, 11, 12], inputFeePpk: 0,
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

			// Exercise the production seller-offline composition: the seller signs one
			// auction catalog, the bidder selects it through the browser builder, and
			// the admission verifier accepts the resulting V3/payment-key bundle.
			const sellerSecret = privateKey(3)
			const sellerActor = bytesToHex(schnorr.getPublicKey(sellerSecret))
			const sellerRecipient = createDemoFridayPaymentSignerFromSecret(privateKey(4))
			const rows = new Map<string, DemoRecipientPrivateRecord<DemoFridaySellerOpeningRefV1>>()
			const journal = {
				async runExclusive<T>(_scope: string, run: () => Promise<T>): Promise<T> { return run() },
				async load(scope: string) { return structuredClone(rows.get(scope) ?? null) },
				async savePrepared(scope: string, record: DemoRecipientPrivateRecord<DemoFridaySellerOpeningRefV1>) {
					rows.set(scope, structuredClone(record))
				},
				async markImported() { throw new Error('unused') },
			}
			try {
				const authorization = await prepareDemoFridayAuctionPayoutAuthorization({
					scope: {
						schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_SCOPE_V1',
						authNetworkId: operation.authNetworkId, chainId: operation.chainId,
						auctionId: operation.auctionId, sellerActor, sellerPaymentPublicKey: compressed(4),
						canonicalMintUrl: mintUrl, activeSatKeysetId: operation.keysetId,
						denominationKeyDigest: operation.denominationKeyDigest,
						startingBid: 1, minIncrement: 1, reserve: 0, originalEndTime: 9_100,
						maximumEndTime: 9_100, maximumPayout: 12, validFrom: 1_000, validUntil: 9_200,
					},
					keyset, journal, recipientKey: sellerRecipient,
					nostr: {
						async getPublicKey() { return sellerActor },
						async signEvent(unsigned) {
							const id = bytesToHex(sha256(utf8ToBytes(JSON.stringify([
								0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content,
							]))))
							return { ...unsigned, id, sig: bytesToHex(schnorr.sign(hexToBytes(id), sellerSecret)) }
						},
					},
					nowSeconds: 1_000,
				})
				const selection = selectDemoFridayAuctionPayout({
					authorization, keyset, nowSeconds: 1_000,
					auction: {
						auctionId: operation.auctionId, sellerActor, sellerPaymentPublicKey: compressed(4),
						status: 'open', startingBid: 1, minIncrement: 1, reserve: 0,
						originalEndTime: 9_100, endTime: 9_100, leaderBidId: operation.replacesBidId,
						leaderActor: operation.priorLeaderActor, leaderBidAmount: 10,
						stateHeight: 1, appHash: 'a'.repeat(64),
					},
					request: {
						auctionId: operation.auctionId, fundingOperationId: operation.fundingOperationId,
						bidderActor: actor, bidAmount: 12, replacesBidId: operation.replacesBidId,
					},
				})
				const catalogWinnerRequest = {
					capability: authorization.authorization.recipientCatalog.capability,
					outputs: selection.outputs,
				}
				operation.winnerRecipientCapabilityDigest = demoRecipientCapabilityDigest(catalogWinnerRequest.capability)
				operation.winnerOutputsDigest = demoOutputsDigest(catalogWinnerRequest.outputs)
				operation.winnerAuctionAuthorizationDigest = authorization.authorizationDigest
				operation.winnerAuctionSelectionDigest = selection.selectionDigest
				const v3PaymentSigner = createDemoFridayPaymentSignerFromSecret(hexToBytes(operation.paymentSecret))
				const v3RefundSigner = createDemoFridayPaymentSignerFromSecret(refundSecret)
				try {
					const v3Signing = createDemoFridayOperationBoundSigning({
						operation, paymentSigner: v3PaymentSigner, refundSigner: v3RefundSigner,
						nostrSigner: {
							async getPublicKey() { return actor },
							async signEvent(unsigned) { return signedEvent(unsigned) },
						},
						lockedToken, winnerRequest: catalogWinnerRequest, refundRequest,
					})
					const v3 = await builder.buildExact({
						operation: demoFridayBrowserPublicOperation(operation), keyset, lockedToken,
						winnerRequest: catalogWinnerRequest, refundDelivery, refundRequest, signing: v3Signing,
						winnerAuctionPayout: { authorization, selection, keyset }, nowSeconds: 1_000,
					})
					const verifiedV3 = verifyDemoFridayPreparedFundingEnvelope(v3.envelope, {
						authNetworkId: operation.authNetworkId, chainId: operation.chainId,
						mintUrl, nowSeconds: 1_000,
					})
					expect(verifiedV3.bundle.winner.schema).toBe('COCO_DEMO_MAINTAINER_EXACT_BRANCH_V3')
					expect(verifiedV3.bundle.actorWinnerAuthorization).toMatchObject({
						schema: 'COCO_DEMO_PAYMENT_KEY_PACKAGE_AUTHORIZATION_V1',
						paymentPublicKey: operation.paymentPublicKey,
					})
					expect(verifiedV3.bundle.actorReturnAuthorization).toMatchObject({
						schema: 'COCO_DEMO_PAYMENT_KEY_PACKAGE_AUTHORIZATION_V1',
						paymentPublicKey: operation.paymentPublicKey,
					})

					// Admission must bind the valid seller-signed V3 catalog to the
					// participant's own authenticated auction state, not merely to an
					// authority registry or to the internally consistent catalog.
					const proofStateRefs = verifiedV3.bundle.winner.inputs
						.map((proof) => bytesToHex(proofPoint(proof).toBytes(true))).sort()
					const terms: DemoIntegratedFundingReceiptV4Terms = {
						schema: 'PlebeianAuctionsPOCIntegratedFundingV4',
						auth_network_id: operation.authNetworkId, chain_id: operation.chainId,
						mint_url: mintUrl, auction_id: operation.auctionId, bidder: actor,
						bid_amount: operation.bidAmount, pool_amount: operation.fullPoolAmount,
						replaces_bid_id: operation.replacesBidId,
						funding_operation_id: operation.fundingOperationId,
						attested_at: 1_000, expires_at: verifiedV3.authorization.content.expiresAt,
						proof_state_refs: proofStateRefs, active_keyset_id: operation.keysetId,
						input_fee_ppk: 0, locktime: operation.lock.locktime,
						bidder_public_key: operation.paymentPublicKey,
						refund_public_key: operation.refundPublicKey,
						committee_public_key: operation.lock.committeePubkey,
						committee_keyset_id: operation.committeeKeysetId,
						committee_keyset_version: operation.committeeKeysetVersion,
						dkg_run_id: operation.dkgRunId,
						public_key_package_sha256: operation.publicKeyPackageSha256,
						signer_roster_digest: operation.signerRosterDigest,
						winner_package_digest: verifiedV3.bundle.winner.templateDigest,
						return_package_digest: verifiedV3.bundle.refund.templateDigest,
						return_cashu_sigall_digest: verifiedV3.bundle.refund.cashuSigAllDigest,
						bidder_return_signature: verifiedV3.bundle.refund.bidderMainSignature,
						prepared_bundle_digest: verifiedV3.bundle.bundleDigest,
						actor_funding_authorization: verifiedV3.authorization.event,
					}
					const receipt = prepareDemoIntegratedFundingReceiptV4(terms)
					const consensusState = (stateSellerActor: string, stateSellerPaymentPublicKey: string) => ({
						async readCommittedLeader() {
							return { leaderBidId: operation.replacesBidId, sellerActor: stateSellerActor,
								sellerPaymentPublicKey: stateSellerPaymentPublicKey, height: 42,
								evidenceDigest: 'b'.repeat(64) }
						},
					})
					const admission = (stateSellerActor: string, stateSellerPaymentPublicKey: string) =>
						validateDemoIntegratedAdmission({
							participantId: 1, receipt, bundle: verifiedV3.bundle, nowSeconds: 1_000,
							dkgBinding: { dkgRunId: operation.dkgRunId,
								publicKeyPackageSha256: operation.publicKeyPackageSha256,
								signerRosterDigest: operation.signerRosterDigest },
							consensus: consensusState(stateSellerActor, stateSellerPaymentPublicKey),
							mintVerifier: { async verifyAndDerive() { return {
								schema: 'COCO_DEMO_INTEGRATED_ADMISSION_MINT_EVIDENCE_V1' as const,
								evidenceDigest: 'c'.repeat(64), mintUrl, activeKeysetId: operation.keysetId,
								inputFeePpk: 0 as const, inputTotal: operation.fullPoolAmount,
								proofStates: proofStateRefs.map((proofStateRef) => ({ proofStateRef, state: 'UNSPENT' as const })),
							} } },
							proofUse: { async assertAvailable() { return { evidenceDigest: 'd'.repeat(64) } } },
						})
					await expect(admission(sellerActor, compressed(4))).resolves.toMatchObject({
						consensusEvidenceDigest: 'b'.repeat(64),
					})
					await expect(admission('f'.repeat(64), compressed(4)))
						.rejects.toThrow(/DEMO_INTEGRATED_ADMISSION_CONSENSUS/)
					await expect(admission(sellerActor, compressed(92)))
						.rejects.toThrow(/DEMO_INTEGRATED_ADMISSION_CONSENSUS/)
				} finally {
					v3PaymentSigner.dispose()
					v3RefundSigner.dispose()
				}
			} finally { sellerRecipient.dispose() }
		} finally { paymentSigner.dispose(); refundSigner.dispose(); refundSecret.fill(0) }
	})
})
