import { describe, expect, test } from 'bun:test'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import {
	claimDemoFridayCommittedAbort, demoFridayFundingAbortActorUnsignedEvent, demoFridayFundingAbortCommitteeDigest,
	emptyDemoFridayFundingLifecycleState,
	type DemoFridayFundingAbortPinsV1,
} from './demo-friday-funding-pool-lifecycle'
import {
	createDemoFridayFundingAbortService,
	type DemoFridayFundingAbortJournalRecordV1, type DemoFridayLockedAbortEvidenceV1,
} from './demo-friday-funding-abort-service'

const actorSecret = '1'.padStart(64, '0'), paymentSecret = '2'.padStart(64, '0')
const refundSecret = '3'.padStart(64, '0'), committeeSecret = '4'.padStart(64, '0')
const compressed = (secret: string) => `02${bytesToHex(schnorr.getPublicKey(hexToBytes(secret)))}`
const xonly = (secret: string) => bytesToHex(schnorr.getPublicKey(hexToBytes(secret)))
const sign = (digest: string, secret: string) => bytesToHex(schnorr.sign(hexToBytes(digest), hexToBytes(secret)))
const H = (value: string) => value.repeat(64).slice(0, 64)
const pins: DemoFridayFundingAbortPinsV1 = {
	authNetworkId: 'friday-demo', chainId: 'friday-chain', genesisSha256: H('a'), mintUrl: 'https://172.105.64.142',
	activeKeysetId: 'zero-fee', committeePublicKey: compressed(committeeSecret), committeeKeysetId: 'committee-1',
	committeeKeysetVersion: '1', dkgRunId: 'dkg-1', publicKeyPackageSha256: H('b'), signerRosterDigest: H('c'),
}
const proofYs = [compressed('5'.padStart(64, '0')), compressed('6'.padStart(64, '0'))].sort()
const evidence = (): DemoFridayLockedAbortEvidenceV1 => ({
	schema: 'PLEBEIAN_FRIDAY_LOCKED_ABORT_EVIDENCE_V1', ...pins, auctionId: 'auction-1', operationId: 'funding-1',
	actor: xonly(actorSecret), amount: 2_500, proofYs, poolDigest: H('d'),
	nut11LockPublicKeys: [compressed(paymentSecret), compressed(committeeSecret)], locktime: 9_400,
	paymentPublicKey: compressed(paymentSecret), refundPublicKey: compressed(refundSecret),
	returnPackageDigest: H('e'), returnCashuSigAllDigest: H('f'),
	bidderReturnSignature: sign(H('f'), paymentSecret), fundingAuthorizationEventId: H('7'),
	abortNotBefore: 1_000, abortExpiresAt: 5_200, dleqVerified: true, ownerVerified: true,
	returnPackageVerified: true, proofStates: proofYs.map((proofY) => ({ proofY, state: 'UNSPENT' as const })),
})

function harness(options: { lostResponse?: boolean; mutateCommit?: boolean; evidence?: DemoFridayLockedAbortEvidenceV1;
	lostTerminalResponse?: boolean; failFirstTransition?: boolean; wrongCommitHeight?: boolean;
	currentProofState?: 'UNSPENT' | 'SPENT' | 'PENDING' | 'UNKNOWN' } = {}) {
	let row: DemoFridayFundingAbortJournalRecordV1 | null = null
	let broadcasts = 0, terminalCalls = 0, terminalEffects = 0
	let transitions = 0
	const completedTerminalOperations = new Set<string>()
	const persisted = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
	const lockedEvidence = persisted(options.evidence ?? evidence())
	const service = createDemoFridayFundingAbortService({
		pins, nowSeconds: () => 1_200,
		capsules: {} as never,
		evidence: { readExact: async () => persisted(lockedEvidence) },
		proofState: { readExact: async (requested) => requested.map((proofY) => ({ proofY,
			state: options.currentProofState ?? 'UNSPENT' })) },
		journalAnchor: { observeExact() {} },
		nostr: {
			getPublicKey: async () => xonly(actorSecret),
			async signEvent(unsigned) {
				const id = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([
					0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content,
				]))))
				return { ...structuredClone(unsigned), id, sig: sign(id, actorSecret) }
			},
		},
		committee: {
			async authorizeExact(input) {
				const participantPolicyDigest = H('8')
				const unsigned = { ...input.actorTerms, participantPolicyDigest, actorAbortEvent: input.actorAbortEvent }
				return { participantPolicyDigest,
					committeeAbortSignature: sign(demoFridayFundingAbortCommitteeDigest(unsigned), committeeSecret),
					participantIds: [1, 2, 3] }
			},
		},
		journal: {
			readExact: async () => persisted(row),
			listRecoverableExact: async () => row === null || row.phase === 'terminal_imported' ? [] : [row.operationId],
			async claimExact(value) { if (row !== null) throw new Error('duplicate'); row = persisted(value); return persisted(row) },
			async transitionExact(prior, next) {
				if (row === null || JSON.stringify(row) !== JSON.stringify(prior)) throw new Error('CAS')
				transitions++
				if (options.failFirstTransition && transitions === 1) throw new Error('coordinator stopped after signed claim')
				row = persisted(next); return persisted(row)
			},
		},
		consensus: {
			async broadcastExact(transaction) {
				broadcasts++
				const transactionHash = bytesToHex(sha256(transaction))
				if (options.lostResponse) throw new Error('response lost')
				return { height: 40, transactionHash }
			},
			async recoverExact(transactionHash) { return { height: 40, transactionHash } },
			async confirmExact(input) {
				const state = claimDemoFridayCommittedAbort(emptyDemoFridayFundingLifecycleState(), input.certificate,
					pins, H('9'), input.height, 1_201)
				return { schema: 'PLEBEIAN_FRIDAY_FUNDING_ABORT_COMMIT_V1', origin: 'committed_abort',
					operationId: input.certificate.operationId,
					consensusEventId: state.records[input.certificate.operationId]!.abortCertificateDigest!,
					actorAuthorizationEventId: input.certificate.actorAbortEvent.id,
					transactionHash: options.mutateCommit ? H('0') : input.transactionHash,
					height: options.wrongCommitHeight ? input.height + 1 : input.height, committedAt: 1_201,
					abortCertificateDigest: state.records[input.certificate.operationId]!.abortCertificateDigest!,
					transactionBlockHash: H('1'), successorHeight: input.height + 1, successorBlockHash: H('2'),
					finalityHeight: input.height + 2, finalityBlockHash: H('3'), validatorsHash: H('4'),
					commitSignerAddresses: ['A'.repeat(40), 'B'.repeat(40), 'C'.repeat(40)],
					stateHeight: input.height + 2, stateAppHash: H('5'),
					stateCommitHeight: input.height + 3, stateCommitAppHash: H('5') } as const
			},
		},
		terminal: {
			async returnOrRecoverExact(input) {
				terminalCalls++
				if (!completedTerminalOperations.has(input.terminalOperationId)) {
					completedTerminalOperations.add(input.terminalOperationId)
					terminalEffects++
					if (options.lostTerminalResponse) throw new Error('terminal response lost')
				}
				return { schema: 'PLEBEIAN_FRIDAY_FUNDING_ABORT_TERMINAL_RESULT_V1',
					operationId: input.certificate.operationId,
					terminalOperationId: input.terminalOperationId,
					abortCertificateDigest: input.commit.abortCertificateDigest,
					status: 'recipient_imported', recipientAckDigest: H('6') }
			},
		},
	})
	return { service, get broadcasts() { return broadcasts }, get terminalCalls() { return terminalCalls },
		get terminalEffects() { return terminalEffects }, get row() { return row }, lockedEvidence }
}

describe('FundingAbortV1 durable coordinator', () => {
	test('prepares public terms, accepts only the exact browser NIP-07 event, and recovers read-only', async () => {
		const run = harness()
		const preparation = await run.service.prepareBrowserExact({ operationId: 'funding-1',
			actor: xonly(actorSecret), abortReason: 'prebroadcast_client_abandonment' })
		const unsigned = demoFridayFundingAbortActorUnsignedEvent(preparation.terms, 1_200)
		const id = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([
			0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content,
		]))))
		const signed = { ...unsigned, id, sig: sign(id, actorSecret) }
		const status = await run.service.submitBrowserExact({ preparationId: preparation.preparationId,
			actorAbortEvent: signed })
		expect(status).toMatchObject({ status: 'COMMITTED_ABORT' })
		if (status.status !== 'COMMITTED_ABORT') throw new Error('fixture')
		expect(status.finality).toMatchObject({ actorAuthorizationEventId: id, commitSignatures: 3 })
		expect(await run.service.readBrowserExact({ preparationId: preparation.preparationId,
			actor: xonly(actorSecret), operationId: 'funding-1' })).toEqual(status)
		expect(run.broadcasts).toBe(1)
	})

	test('reports the fresh post-finality NUT-07 state rather than the pre-broadcast snapshot', async () => {
		const run = harness({ currentProofState: 'SPENT' })
		const preparation = await run.service.prepareBrowserExact({ operationId: 'funding-1',
			actor: xonly(actorSecret), abortReason: 'prebroadcast_service_failure' })
		const unsigned = demoFridayFundingAbortActorUnsignedEvent(preparation.terms, 1_200)
		const id = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([
			0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content,
		]))))
		const status = await run.service.submitBrowserExact({ preparationId: preparation.preparationId,
			actorAbortEvent: { ...unsigned, id, sig: sign(id, actorSecret) } })
		if (status.status !== 'COMMITTED_ABORT') throw new Error('fixture')
		expect(status.proofStates.every(({ state }) => state === 'SPENT')).toBe(true)
	})

	test('commits exact abort then imports one terminal return', async () => {
		const run = harness()
		const committed = await run.service.requestExact({ operationId: 'funding-1', abortReason: 'prebroadcast_service_failure' })
		expect(committed.phase).toBe('committed')
		const imported = await run.service.importExact('funding-1')
		expect(imported).toMatchObject({ phase: 'terminal_imported', terminal: { status: 'recipient_imported' } })
		const recovered = await run.service.importExact('funding-1')
		expect(recovered).toMatchObject({ phase: 'terminal_imported' })
		expect(run.terminalCalls).toBe(1)
	})

	test('lost response remains unavailable and recovers exact tx without rebroadcast', async () => {
		const run = harness({ lostResponse: true })
		await expect(run.service.requestExact({ operationId: 'funding-1', abortReason: 'prebroadcast_client_abandonment' }))
			.rejects.toThrow(/response lost/)
		expect(run.row).toMatchObject({ phase: 'broadcasting' })
		await expect(run.service.recoverExact('funding-1')).resolves.toMatchObject({ phase: 'committed' })
		expect(run.broadcasts).toBe(1)
	})

	test('startup drain recovers one unknown broadcast and its terminal operation exactly once', async () => {
		const run = harness({ lostResponse: true })
		await expect(run.service.requestExact({ operationId: 'funding-1', abortReason: 'prebroadcast_client_abandonment' }))
			.rejects.toThrow(/response lost/)
		expect(await run.service.recoverOnePendingExact()).toBe('recovered')
		expect(run.row).toMatchObject({ phase: 'terminal_imported' })
		expect(run.broadcasts).toBe(1)
		expect(run.terminalEffects).toBe(1)
		expect(await run.service.recoverOnePendingExact()).toBe('idle')
	})

	test('recovers a signed pre-I/O crash by broadcasting the persisted bytes once', async () => {
		const run = harness({ failFirstTransition: true })
		await expect(run.service.requestExact({ operationId: 'funding-1', abortReason: 'prebroadcast_service_failure' }))
			.rejects.toThrow(/stopped after signed claim/)
		expect(run.row?.phase).toBe('signed')
		await expect(run.service.recoverExact('funding-1')).resolves.toMatchObject({ phase: 'committed' })
		expect(run.broadcasts).toBe(1)
	})

	test('lost terminal response recovers the persisted operation without a second spend', async () => {
		const run = harness({ lostTerminalResponse: true })
		await run.service.requestExact({ operationId: 'funding-1', abortReason: 'prebroadcast_service_failure' })
		await expect(run.service.importExact('funding-1')).rejects.toThrow(/terminal response lost/)
		expect(run.row?.phase).toBe('terminal_pending')
		expect(run.row?.terminalOperationId).toMatch(/^[0-9a-f]{64}$/)
		const recovered = await run.service.importExact('funding-1')
		expect(recovered).toMatchObject({ phase: 'terminal_imported' })
		expect(run.terminalCalls).toBe(2)
		expect(run.terminalEffects).toBe(1)
	})

	test('fails closed before signing on non-UNSPENT or mismatched locked evidence', async () => {
		const bad = evidence()
		bad.proofStates[0] = { proofY: bad.proofYs[0]!, state: 'PENDING' as never }
		const run = harness({ evidence: bad })
		await expect(run.service.requestExact({ operationId: 'funding-1', abortReason: 'prebroadcast_service_failure' }))
			.rejects.toThrow(/locked Coco evidence/)
		expect(run.row).toBeNull()
	})

	test('rejects mutated authenticated finality and never starts terminal return', async () => {
		const run = harness({ mutateCommit: true })
		await expect(run.service.requestExact({ operationId: 'funding-1', abortReason: 'prebroadcast_service_failure' }))
			.rejects.toThrow(/commit differs/)
		expect(run.row).toMatchObject({ phase: 'broadcasting' })
		expect(run.terminalCalls).toBe(0)
	})

	test('rejects wrong commit height and changed locked evidence before terminal effects', async () => {
		const wrongHeight = harness({ wrongCommitHeight: true })
		await expect(wrongHeight.service.requestExact({ operationId: 'funding-1', abortReason: 'prebroadcast_service_failure' }))
			.rejects.toThrow(/commit differs/)
		const changed = harness()
		await changed.service.requestExact({ operationId: 'funding-1', abortReason: 'prebroadcast_service_failure' })
		changed.lockedEvidence.poolDigest = H('0')
		await expect(changed.service.importExact('funding-1')).rejects.toThrow(/evidence differs|evidence changed/)
		expect(changed.terminalCalls).toBe(0)
	})
})
