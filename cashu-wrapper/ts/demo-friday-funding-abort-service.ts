/** Durable coordinator for the approved fake-money FundingAbortV1 path. */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

import {
	claimDemoFridayCommittedAbort, demoFridayFundingAbortActorUnsignedEvent,
	emptyDemoFridayFundingLifecycleState,
	type DemoFridayFundingAbortCertificateV1, type DemoFridayFundingAbortNostrEventV1,
	type DemoFridayFundingAbortPinsV1,
} from './demo-friday-funding-pool-lifecycle'
import type {
	DemoFridayBrowserAbortPreparationV1,
	DemoFridayBrowserAbortStatusV1,
} from './demo-friday-browser-funding-abort'
import {
	validateDemoFridayFundingAbortRecoveryCapsule,
	type DemoFridayFundingAbortCapsuleStore,
	type DemoFridayFundingAbortRecoveryCapsuleV1,
} from './demo-friday-funding-abort-capsule'

const HEX_32 = /^[0-9a-f]{64}$/
const HEX = /^(?:[0-9a-f]{2})+$/
const COMET_ADDRESS = /^[0-9A-F]{40}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/
function refuse(message: string): never { throw new Error(`DEMO_FRIDAY_FUNDING_ABORT_SERVICE: ${message}`) }
function digest(value: Uint8Array | string): string {
	return bytesToHex(sha256(typeof value === 'string' ? new TextEncoder().encode(value) : value))
}
function exactKeys(value: object, expected: string[], label: string): void {
	if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) refuse(`${label} fields differ`)
}
function canonical(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value)) refuse('canonical value has a non-safe integer')
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
	if (typeof value !== 'object') refuse('canonical value is unsupported')
	const record = value as Record<string, unknown>
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

export interface DemoFridayLockedAbortEvidenceV1 {
	schema: 'PLEBEIAN_FRIDAY_LOCKED_ABORT_EVIDENCE_V1'
	authNetworkId: string; chainId: string; genesisSha256: string; auctionId: string; operationId: string
	actor: string; mintUrl: string; activeKeysetId: string; amount: number; proofYs: string[]; poolDigest: string
	nut11LockPublicKeys: [string, string]; locktime: number; paymentPublicKey: string; refundPublicKey: string
	committeePublicKey: string; returnPackageDigest: string; returnCashuSigAllDigest: string
	bidderReturnSignature: string; fundingAuthorizationEventId: string; abortNotBefore: number; abortExpiresAt: number
	committeeKeysetId: string; committeeKeysetVersion: string; dkgRunId: string
	publicKeyPackageSha256: string; signerRosterDigest: string
	dleqVerified: true; ownerVerified: true; returnPackageVerified: true
	proofStates: Array<{ proofY: string; state: 'UNSPENT' }>
}

export interface DemoFridayFundingAbortJournalRecordV1 {
	schema: 'PLEBEIAN_FRIDAY_FUNDING_ABORT_JOURNAL_V1'
	operationId: string
	phase: 'signed' | 'broadcasting' | 'committed' | 'terminal_pending' | 'terminal_imported'
	revision: number
	certificate: DemoFridayFundingAbortCertificateV1
	transactionHex: string
	transactionHash: string
	abortCertificateDigest: string
	lockedEvidenceDigest: string
	terminalOperationId?: string
	commit?: DemoFridayFundingAbortCommitV1
	terminal?: DemoFridayFundingAbortTerminalResultV1
}

export interface DemoFridayFundingAbortCommitV1 {
	schema: 'PLEBEIAN_FRIDAY_FUNDING_ABORT_COMMIT_V1'
	origin: 'committed_abort'; operationId: string; consensusEventId: string; transactionHash: string
	actorAuthorizationEventId: string
	height: number; committedAt: number; abortCertificateDigest: string
	transactionBlockHash: string; successorHeight: number; successorBlockHash: string
	finalityHeight: number; finalityBlockHash: string; validatorsHash: string
	commitSignerAddresses: string[]; stateHeight: number; stateAppHash: string
	stateCommitHeight: number; stateCommitAppHash: string
}

export interface DemoFridayFundingAbortTerminalResultV1 {
	schema: 'PLEBEIAN_FRIDAY_FUNDING_ABORT_TERMINAL_RESULT_V1'
	operationId: string; terminalOperationId: string; abortCertificateDigest: string
	status: 'recipient_imported'; recipientAckDigest: string
}

type ActorUnsigned = Omit<DemoFridayFundingAbortCertificateV1,
	'participantPolicyDigest' | 'actorAbortEvent' | 'committeeAbortSignature'>

export interface DemoFridayFundingAbortJournalPort {
	readExact(operationId: string): Promise<DemoFridayFundingAbortJournalRecordV1 | null>
	listRecoverableExact(): Promise<string[]>
	claimExact(record: DemoFridayFundingAbortJournalRecordV1): Promise<DemoFridayFundingAbortJournalRecordV1>
	transitionExact(prior: DemoFridayFundingAbortJournalRecordV1,
		next: DemoFridayFundingAbortJournalRecordV1): Promise<DemoFridayFundingAbortJournalRecordV1>
}
export interface DemoFridayFundingAbortJournalAnchorPort {
	/** Must observe an anchor stored outside the journal/backup boundary. */
	observeExact(): void
}
export interface DemoFridayLockedAbortEvidencePort {
	readExact(operationId: string): Promise<DemoFridayLockedAbortEvidenceV1>
}
export interface DemoFridayFundingAbortProofStatePort {
	readExact(proofYs: string[]): Promise<Array<{ proofY: string; state: 'UNSPENT' | 'SPENT' | 'PENDING' | 'UNKNOWN' }>>
}
export interface DemoFridayFundingAbortNostrSignerPort {
	getPublicKey(): Promise<string>
	signEvent(event: Omit<DemoFridayFundingAbortNostrEventV1, 'id' | 'sig'>): Promise<DemoFridayFundingAbortNostrEventV1>
}
export interface DemoFridayFundingAbortCommitteePort {
	authorizeExact(input: { actorTerms: ActorUnsigned; actorAbortEvent: DemoFridayFundingAbortNostrEventV1;
		evidence: DemoFridayLockedAbortEvidenceV1; abortReason: DemoFridayFundingAbortCertificateV1['abortReason'] }): Promise<{
		participantPolicyDigest: string; committeeAbortSignature: string; participantIds: [number, number, number]
	}>
}
export interface DemoFridayFundingAbortConsensusPort {
	broadcastExact(transaction: Uint8Array): Promise<{ height: number; transactionHash: string }>
	recoverExact(transactionHash: string): Promise<{ height: number; transactionHash: string } | null>
	confirmExact(input: { certificate: DemoFridayFundingAbortCertificateV1; transaction: Uint8Array;
		transactionHash: string; height: number }): Promise<DemoFridayFundingAbortCommitV1>
}
export interface DemoFridayFundingAbortTerminalPort {
	/**
	 * Start or recover one exact terminal return. Implementations MUST use the
	 * supplied operation ID as their durable mint/recovery identity and MUST NOT
	 * create a second spend when the caller retries after an unknown response.
	 */
	returnOrRecoverExact(input: { terminalOperationId: string; certificate: DemoFridayFundingAbortCertificateV1;
		commit: DemoFridayFundingAbortCommitV1; evidence: DemoFridayLockedAbortEvidenceV1
	}): Promise<DemoFridayFundingAbortTerminalResultV1>
}

export interface DemoFridayFundingAbortServiceOptions {
	pins: DemoFridayFundingAbortPinsV1
	evidence: DemoFridayLockedAbortEvidencePort
	proofState: DemoFridayFundingAbortProofStatePort
	/** Test-only compatibility path. Browser activation MUST omit this signer. */
	nostr?: DemoFridayFundingAbortNostrSignerPort
	committee: DemoFridayFundingAbortCommitteePort
	journal: DemoFridayFundingAbortJournalPort
	journalAnchor: DemoFridayFundingAbortJournalAnchorPort
	consensus: DemoFridayFundingAbortConsensusPort
	terminal: DemoFridayFundingAbortTerminalPort
	nowSeconds(): number
	capsules: DemoFridayFundingAbortCapsuleStore
}

function validateEvidence(value: DemoFridayLockedAbortEvidenceV1, pins: DemoFridayFundingAbortPinsV1): string {
	exactKeys(value as unknown as object, ['schema', 'authNetworkId', 'chainId', 'genesisSha256', 'auctionId',
		'operationId', 'actor', 'mintUrl', 'activeKeysetId', 'amount', 'proofYs', 'poolDigest',
		'nut11LockPublicKeys', 'locktime', 'paymentPublicKey', 'refundPublicKey', 'committeePublicKey',
		'returnPackageDigest', 'returnCashuSigAllDigest', 'bidderReturnSignature', 'fundingAuthorizationEventId',
		'abortNotBefore', 'abortExpiresAt', 'committeeKeysetId', 'committeeKeysetVersion', 'dkgRunId',
		'publicKeyPackageSha256', 'signerRosterDigest', 'dleqVerified', 'ownerVerified',
		'returnPackageVerified', 'proofStates'], 'locked evidence')
	if (value.schema !== 'PLEBEIAN_FRIDAY_LOCKED_ABORT_EVIDENCE_V1' || !ID.test(value.operationId)
		|| value.dleqVerified !== true || value.ownerVerified !== true || value.returnPackageVerified !== true
		|| value.proofStates.length !== value.proofYs.length
		|| value.proofStates.some((proof, index) => proof.proofY !== value.proofYs[index] || proof.state !== 'UNSPENT')
		|| value.authNetworkId !== pins.authNetworkId || value.chainId !== pins.chainId
		|| value.genesisSha256 !== pins.genesisSha256 || value.mintUrl !== pins.mintUrl
		|| value.activeKeysetId !== pins.activeKeysetId || value.committeePublicKey !== pins.committeePublicKey
		|| value.committeeKeysetId !== pins.committeeKeysetId
		|| value.committeeKeysetVersion !== pins.committeeKeysetVersion || value.dkgRunId !== pins.dkgRunId
		|| value.publicKeyPackageSha256 !== pins.publicKeyPackageSha256
		|| value.signerRosterDigest !== pins.signerRosterDigest) refuse('locked Coco evidence is not exact and trusted')
	return digest(canonical(value))
}

function evidenceMatchesCertificate(value: DemoFridayLockedAbortEvidenceV1,
	certificate: DemoFridayFundingAbortCertificateV1): void {
	const comparisons: Array<[string, unknown, unknown]> = [
		['authNetworkId', value.authNetworkId, certificate.authNetworkId], ['chainId', value.chainId, certificate.chainId],
		['genesisSha256', value.genesisSha256, certificate.genesisSha256], ['auctionId', value.auctionId, certificate.auctionId],
		['operationId', value.operationId, certificate.operationId], ['actor', value.actor, certificate.actor],
		['mintUrl', value.mintUrl, certificate.mintUrl], ['activeKeysetId', value.activeKeysetId, certificate.activeKeysetId],
		['amount', value.amount, certificate.amount], ['proofYs', canonical(value.proofYs), canonical(certificate.proofYs)],
		['poolDigest', value.poolDigest, certificate.poolDigest],
		['nut11LockPublicKeys', canonical(value.nut11LockPublicKeys), canonical(certificate.nut11LockPublicKeys)],
		['locktime', value.locktime, certificate.locktime], ['paymentPublicKey', value.paymentPublicKey, certificate.paymentPublicKey],
		['refundPublicKey', value.refundPublicKey, certificate.refundPublicKey],
		['committeePublicKey', value.committeePublicKey, certificate.committeePublicKey],
		['returnPackageDigest', value.returnPackageDigest, certificate.returnPackageDigest],
		['returnCashuSigAllDigest', value.returnCashuSigAllDigest, certificate.returnCashuSigAllDigest],
		['bidderReturnSignature', value.bidderReturnSignature, certificate.bidderReturnSignature],
		['fundingAuthorizationEventId', value.fundingAuthorizationEventId, certificate.fundingAuthorizationEventId],
		['abortNotBefore', value.abortNotBefore, certificate.abortNotBefore],
		['abortExpiresAt', value.abortExpiresAt, certificate.abortExpiresAt],
		['committeeKeysetId', value.committeeKeysetId, certificate.committeeKeysetId],
		['committeeKeysetVersion', value.committeeKeysetVersion, certificate.committeeKeysetVersion],
		['dkgRunId', value.dkgRunId, certificate.dkgRunId],
		['publicKeyPackageSha256', value.publicKeyPackageSha256, certificate.publicKeyPackageSha256],
		['signerRosterDigest', value.signerRosterDigest, certificate.signerRosterDigest],
	]
	for (const [label, left, right] of comparisons) {
		if (left !== right) refuse(`locked Coco evidence differs from abort certificate (${label})`)
	}
}

function actorTerms(evidence: DemoFridayLockedAbortEvidenceV1,
	abortReason: DemoFridayFundingAbortCertificateV1['abortReason']): ActorUnsigned {
	return {
		schema: 'PLEBEIAN_FRIDAY_FUNDING_ABORT_V1', authNetworkId: evidence.authNetworkId,
		chainId: evidence.chainId, genesisSha256: evidence.genesisSha256, auctionId: evidence.auctionId,
		operationId: evidence.operationId, actor: evidence.actor, mintUrl: evidence.mintUrl,
		activeKeysetId: evidence.activeKeysetId, amount: evidence.amount, proofYs: structuredClone(evidence.proofYs),
		poolDigest: evidence.poolDigest, nut11LockPublicKeys: structuredClone(evidence.nut11LockPublicKeys),
		locktime: evidence.locktime, paymentPublicKey: evidence.paymentPublicKey,
		refundPublicKey: evidence.refundPublicKey, committeePublicKey: evidence.committeePublicKey,
		returnPackageDigest: evidence.returnPackageDigest, returnCashuSigAllDigest: evidence.returnCashuSigAllDigest,
		bidderReturnSignature: evidence.bidderReturnSignature,
		fundingAuthorizationEventId: evidence.fundingAuthorizationEventId,
		abortNotBefore: evidence.abortNotBefore, abortExpiresAt: evidence.abortExpiresAt, abortReason,
		committeeKeysetId: evidence.committeeKeysetId, committeeKeysetVersion: evidence.committeeKeysetVersion,
		dkgRunId: evidence.dkgRunId, publicKeyPackageSha256: evidence.publicKeyPackageSha256,
		signerRosterDigest: evidence.signerRosterDigest,
	}
}

function encodedTransaction(certificate: DemoFridayFundingAbortCertificateV1): Uint8Array {
	return new TextEncoder().encode(JSON.stringify({ version: 1, type: 'funding_abort', funding_abort: certificate }))
}

function browserPreparationId(terms: ActorUnsigned): string {
	return digest(canonical(['PLEBEIAN_FRIDAY_BROWSER_FUNDING_ABORT_PREPARATION_V1', terms]))
}

function browserPreparation(terms: ActorUnsigned): DemoFridayBrowserAbortPreparationV1 {
	return {
		schema: 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_ABORT_PREPARATION_V1',
		preparationId: browserPreparationId(terms), terms: structuredClone(terms),
	}
}

function next(prior: DemoFridayFundingAbortJournalRecordV1,
	patch: Partial<DemoFridayFundingAbortJournalRecordV1>): DemoFridayFundingAbortJournalRecordV1 {
	return { ...structuredClone(prior), ...structuredClone(patch), revision: prior.revision + 1 }
}

function exactCommit(row: DemoFridayFundingAbortJournalRecordV1, commit: DemoFridayFundingAbortCommitV1,
	expectedHeight: number): void {
	exactKeys(commit as unknown as object, ['schema', 'origin', 'operationId', 'consensusEventId', 'actorAuthorizationEventId',
		'transactionHash', 'height', 'committedAt', 'abortCertificateDigest', 'transactionBlockHash',
		'successorHeight', 'successorBlockHash', 'finalityHeight', 'finalityBlockHash', 'validatorsHash',
		'commitSignerAddresses', 'stateHeight', 'stateAppHash', 'stateCommitHeight', 'stateCommitAppHash'],
	'authenticated abort commit')
	if (commit.schema !== 'PLEBEIAN_FRIDAY_FUNDING_ABORT_COMMIT_V1' || commit.origin !== 'committed_abort'
		|| commit.operationId !== row.operationId || commit.transactionHash !== row.transactionHash
		|| commit.abortCertificateDigest !== row.abortCertificateDigest
		|| commit.consensusEventId !== row.abortCertificateDigest
		|| commit.actorAuthorizationEventId !== row.certificate.actorAbortEvent.id
		|| !Number.isSafeInteger(commit.height) || commit.height < 1 || commit.height !== expectedHeight
		|| !Number.isSafeInteger(commit.committedAt)
		|| commit.committedAt < row.certificate.abortNotBefore || commit.committedAt > row.certificate.abortExpiresAt
		|| !Number.isSafeInteger(commit.successorHeight) || !Number.isSafeInteger(commit.finalityHeight)
		|| !Number.isSafeInteger(commit.stateHeight) || !Number.isSafeInteger(commit.stateCommitHeight)
		|| commit.successorHeight !== commit.height + 1 || commit.finalityHeight !== commit.height + 2
		|| commit.stateHeight < commit.finalityHeight || commit.stateCommitHeight !== commit.stateHeight + 1
		|| commit.stateAppHash !== commit.stateCommitAppHash
		|| ![commit.transactionBlockHash, commit.successorBlockHash, commit.finalityBlockHash,
			commit.validatorsHash, commit.stateAppHash].every((value) => HEX_32.test(value))
		|| !Array.isArray(commit.commitSignerAddresses) || commit.commitSignerAddresses.length < 3
		|| commit.commitSignerAddresses.some((value) => !COMET_ADDRESS.test(value))
		|| new Set(commit.commitSignerAddresses).size !== commit.commitSignerAddresses.length) {
		refuse('authenticated abort commit differs from the durable operation')
	}
}

function exactRow(value: DemoFridayFundingAbortJournalRecordV1, pins: DemoFridayFundingAbortPinsV1): DemoFridayFundingAbortJournalRecordV1 {
	const expected = ['schema', 'operationId', 'phase', 'revision', 'certificate', 'transactionHex',
		'transactionHash', 'abortCertificateDigest', 'lockedEvidenceDigest']
	if (value.commit !== undefined) expected.push('commit')
	if (value.terminalOperationId !== undefined) expected.push('terminalOperationId')
	if (value.terminal !== undefined) expected.push('terminal')
	exactKeys(value as unknown as object, expected, 'durable abort row')
	if (value.schema !== 'PLEBEIAN_FRIDAY_FUNDING_ABORT_JOURNAL_V1' || !ID.test(value.operationId)
		|| !['signed', 'broadcasting', 'committed', 'terminal_pending', 'terminal_imported'].includes(value.phase)
		|| !Number.isSafeInteger(value.revision) || value.revision < 0 || !HEX.test(value.transactionHex)
		|| !HEX_32.test(value.transactionHash) || !HEX_32.test(value.abortCertificateDigest)
		|| !HEX_32.test(value.lockedEvidenceDigest)) refuse('durable abort row is malformed')
	const tx = Uint8Array.from(Buffer.from(value.transactionHex, 'hex'))
	if (digest(tx) !== value.transactionHash || Buffer.from(encodedTransaction(value.certificate)).toString('hex') !== value.transactionHex) {
		refuse('durable abort transaction identity changed')
	}
	const validated = claimDemoFridayCommittedAbort(emptyDemoFridayFundingLifecycleState(), value.certificate,
		pins, '0'.repeat(64), 1, value.certificate.abortNotBefore)
	if (validated.records[value.operationId]?.abortCertificateDigest !== value.abortCertificateDigest) {
		refuse('durable abort certificate identity changed')
	}
	if ((value.phase === 'signed' || value.phase === 'broadcasting')
		&& (value.commit !== undefined || value.terminal !== undefined || value.terminalOperationId !== undefined)) {
		refuse('pre-commit abort row contains terminal fields')
	}
	if (['committed', 'terminal_pending', 'terminal_imported'].includes(value.phase)) {
		if (value.commit === undefined) refuse('post-commit abort row lacks commit')
		exactCommit(value, value.commit, value.commit.height)
	}
	if (value.phase === 'committed' && (value.terminal !== undefined || value.terminalOperationId !== undefined)) {
		refuse('committed abort row contains premature terminal fields')
	}
	if (value.phase === 'terminal_pending' && (!HEX_32.test(value.terminalOperationId ?? '') || value.terminal !== undefined)) {
		refuse('pending terminal row identity is invalid')
	}
	if (value.phase === 'terminal_imported' && (!HEX_32.test(value.terminalOperationId ?? '')
		|| value.terminal === undefined || value.terminal.terminalOperationId !== value.terminalOperationId)) {
		refuse('imported terminal row identity is invalid')
	}
	if ((value.phase === 'terminal_pending' || value.phase === 'terminal_imported')
		&& value.terminalOperationId !== terminalOperationId(value)) {
		refuse('terminal operation identity differs from committed abort')
	}
	if (value.terminal !== undefined) {
		exactKeys(value.terminal as unknown as object, ['schema', 'operationId', 'terminalOperationId',
			'abortCertificateDigest', 'status', 'recipientAckDigest'], 'terminal result')
		if (value.terminal.schema !== 'PLEBEIAN_FRIDAY_FUNDING_ABORT_TERMINAL_RESULT_V1'
			|| value.terminal.status !== 'recipient_imported' || value.terminal.operationId !== value.operationId
			|| value.terminal.abortCertificateDigest !== value.abortCertificateDigest
			|| !HEX_32.test(value.terminal.recipientAckDigest)) refuse('terminal result is malformed')
	}
	return structuredClone(value)
}

function terminalOperationId(row: DemoFridayFundingAbortJournalRecordV1): string {
	if (row.commit === undefined) refuse('abort commit disappeared')
	return digest(new TextEncoder().encode([
		'PLEBEIAN_FRIDAY_FUNDING_ABORT_TERMINAL_OPERATION_V1', row.operationId,
		row.abortCertificateDigest, row.commit.consensusEventId, row.commit.transactionHash,
		String(row.commit.height),
	].join('\n')))
}

export function createDemoFridayFundingAbortService(options: DemoFridayFundingAbortServiceOptions) {
	function observeAnchor(): void { options.journalAnchor.observeExact() }
	async function lockedTerms(operationId: string,
		abortReason: DemoFridayFundingAbortCertificateV1['abortReason']): Promise<{
			evidence: DemoFridayLockedAbortEvidenceV1; terms: ActorUnsigned
		}> {
		const evidence = await options.evidence.readExact(operationId)
		validateEvidence(evidence, options.pins)
		if (evidence.operationId !== operationId) refuse('evidence belongs to another operation')
		return { evidence, terms: actorTerms(evidence, abortReason) }
	}
	async function readRow(operationId: string): Promise<DemoFridayFundingAbortJournalRecordV1 | null> {
		observeAnchor()
		const value = await options.journal.readExact(operationId)
		observeAnchor()
		return value === null ? null : exactRow(value, options.pins)
	}
	async function claimRow(value: DemoFridayFundingAbortJournalRecordV1): Promise<DemoFridayFundingAbortJournalRecordV1> {
		observeAnchor()
		const claimed = exactRow(await options.journal.claimExact(exactRow(value, options.pins)), options.pins)
		observeAnchor()
		return claimed
	}
	async function transitionRow(prior: DemoFridayFundingAbortJournalRecordV1,
		value: DemoFridayFundingAbortJournalRecordV1): Promise<DemoFridayFundingAbortJournalRecordV1> {
		observeAnchor()
		const transitioned = exactRow(await options.journal.transitionExact(exactRow(prior, options.pins),
			exactRow(value, options.pins)), options.pins)
		observeAnchor()
		return transitioned
	}
	async function confirm(row: DemoFridayFundingAbortJournalRecordV1, height: number): Promise<DemoFridayFundingAbortJournalRecordV1> {
		const transaction = Uint8Array.from(Buffer.from(row.transactionHex, 'hex'))
		const commit = await options.consensus.confirmExact({ certificate: row.certificate, transaction,
			transactionHash: row.transactionHash, height })
		exactCommit(row, commit, height)
		return transitionRow(row, next(row, { phase: 'committed', commit }))
	}
	async function broadcast(row: DemoFridayFundingAbortJournalRecordV1): Promise<DemoFridayFundingAbortJournalRecordV1> {
		if (row.phase === 'signed') row = await transitionRow(row, next(row, { phase: 'broadcasting' }))
		if (row.phase !== 'broadcasting') refuse('only a signed operation can begin broadcast')
		const tx = Uint8Array.from(Buffer.from(row.transactionHex, 'hex'))
		const result = await options.consensus.broadcastExact(tx)
		if (result.transactionHash !== row.transactionHash) refuse('broadcast returned another transaction hash')
		return confirm(row, result.height)
	}
	async function claimAndBroadcast(evidence: DemoFridayLockedAbortEvidenceV1, terms: ActorUnsigned,
		actorAbortEvent: DemoFridayFundingAbortNostrEventV1): Promise<DemoFridayFundingAbortJournalRecordV1> {
		const authorization = await options.committee.authorizeExact({ actorTerms: terms, actorAbortEvent,
			evidence, abortReason: terms.abortReason })
		if (authorization.participantIds.length !== 3 || new Set(authorization.participantIds).size !== 3) {
			refuse('abort authorization is not an independent 3-of-4 quorum')
		}
		const certificate: DemoFridayFundingAbortCertificateV1 = { ...terms, actorAbortEvent,
			participantPolicyDigest: authorization.participantPolicyDigest,
			committeeAbortSignature: authorization.committeeAbortSignature }
		evidenceMatchesCertificate(evidence, certificate)
		const provisional = claimDemoFridayCommittedAbort(emptyDemoFridayFundingLifecycleState(), certificate,
			options.pins, '0'.repeat(64), 1, options.nowSeconds())
		const abortCertificateDigest = provisional.records[terms.operationId]?.abortCertificateDigest
		if (!HEX_32.test(abortCertificateDigest ?? '')) refuse('validated abort lacks a certificate digest')
		const tx = encodedTransaction(certificate), transactionHash = digest(tx)
		const signed: DemoFridayFundingAbortJournalRecordV1 = {
			schema: 'PLEBEIAN_FRIDAY_FUNDING_ABORT_JOURNAL_V1', operationId: terms.operationId,
			phase: 'signed', revision: 0, certificate, transactionHex: bytesToHex(tx), transactionHash,
			abortCertificateDigest: abortCertificateDigest!, lockedEvidenceDigest: validateEvidence(evidence, options.pins),
		}
		return broadcast(await claimRow(signed))
	}
	async function browserStatus(row: DemoFridayFundingAbortJournalRecordV1,
		evidence: DemoFridayLockedAbortEvidenceV1): Promise<DemoFridayBrowserAbortStatusV1> {
		const preparationId = browserPreparationId(actorTerms(evidence, row.certificate.abortReason))
		const base = { schema: 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_ABORT_STATUS_V1' as const,
			preparationId, actor: evidence.actor, fundingOperationId: evidence.operationId }
		if (row.phase === 'signed') return { ...base, status: 'PENDING' }
		if (row.phase === 'broadcasting') return { ...base, status: 'UNKNOWN' }
		if (row.commit === undefined) refuse('committed abort lacks authenticated finality')
		const signatures = row.commit.commitSignerAddresses.length
		if (signatures !== 3 && signatures !== 4) refuse('abort finality is not 3-of-4 or 4-of-4')
		const proofStates = await options.proofState.readExact(evidence.proofYs)
		if (proofStates.length !== evidence.proofYs.length || proofStates.some((proof, index) =>
			proof.proofY !== evidence.proofYs[index]
			|| !['UNSPENT', 'SPENT', 'PENDING', 'UNKNOWN'].includes(proof.state))) {
			refuse('post-finality NUT-07 proof state differs from locked pool')
		}
		return { ...base, status: 'COMMITTED_ABORT', certificate: structuredClone(row.certificate),
			finality: {
				schema: 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_ABORT_FINALITY_V1',
				actorAuthorizationEventId: row.commit.actorAuthorizationEventId,
				lifecycleEventId: row.commit.consensusEventId, transactionHash: row.commit.transactionHash,
				committedHeight: row.commit.height, committedAt: row.commit.committedAt,
				appHash: row.commit.stateAppHash, blockHash: row.commit.transactionBlockHash,
				commitSignatures: signatures,
			}, proofStates,
		}
	}

	return Object.freeze({
		async registerBrowserCapsuleExact(value: DemoFridayFundingAbortRecoveryCapsuleV1) {
			const capsule = validateDemoFridayFundingAbortRecoveryCapsule(value)
			const stored = await options.capsules.persistExact(capsule)
			if (stored.capsuleDigest !== capsule.capsuleDigest) refuse('stored abort capsule identity changed')
			return { capsuleDigest: capsule.capsuleDigest }
		},
		async prepareBrowserExact(input: { operationId: string; actor: string;
			abortReason: DemoFridayFundingAbortCertificateV1['abortReason'] }) {
			const { evidence, terms } = await lockedTerms(input.operationId, input.abortReason)
			if (input.actor !== evidence.actor) refuse('browser actor differs from locked Coco owner')
			return browserPreparation(terms)
		},

		async submitBrowserExact(input: { preparationId: string; actorAbortEvent: DemoFridayFundingAbortNostrEventV1 }) {
			if (!HEX_32.test(input.preparationId)) refuse('browser abort preparation identity is malformed')
			let parsed: unknown
			try { parsed = JSON.parse(input.actorAbortEvent.content) as unknown }
			catch { return refuse('browser abort event content is malformed') }
			if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
				refuse('browser abort event content is malformed')
			}
			const content = parsed as Record<string, unknown>
			if (!ID.test(String(content.operationId))
				|| !['prebroadcast_client_abandonment', 'prebroadcast_service_failure'].includes(String(content.abortReason))) {
				refuse('browser abort event does not identify one supported operation')
			}
			const operationId = String(content.operationId)
			const abortReason = String(content.abortReason) as DemoFridayFundingAbortCertificateV1['abortReason']
			const { evidence, terms } = await lockedTerms(operationId, abortReason)
			if (browserPreparationId(terms) !== input.preparationId) refuse('browser abort preparation changed')
			const existing = await readRow(operationId)
			if (existing !== null) {
				if (existing.certificate.actorAbortEvent.id !== input.actorAbortEvent.id) {
					refuse('another actor authorization already owns this abort')
				}
				return await browserStatus(existing, evidence)
			}
			const committed = await claimAndBroadcast(evidence, terms, input.actorAbortEvent)
			const currentEvidence = await options.evidence.readExact(operationId)
			validateEvidence(currentEvidence, options.pins)
			evidenceMatchesCertificate(currentEvidence, committed.certificate)
			return await browserStatus(committed, currentEvidence)
		},

		async readBrowserExact(input: { preparationId: string; actor: string; operationId: string }) {
			if (!HEX_32.test(input.preparationId) || !HEX_32.test(input.actor) || !ID.test(input.operationId)) {
				refuse('browser abort recovery identity is malformed')
			}
			let row = await readRow(input.operationId)
			if (row === null) return { schema: 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_ABORT_STATUS_V1' as const,
				preparationId: input.preparationId, actor: input.actor,
				fundingOperationId: input.operationId, status: 'UNKNOWN' as const }
			if (row.phase === 'broadcasting') {
				const recovered = await options.consensus.recoverExact(row.transactionHash)
				if (recovered !== null) row = await confirm(row, recovered.height)
			}
			const evidence = await options.evidence.readExact(input.operationId)
			validateEvidence(evidence, options.pins)
			if (evidence.actor !== input.actor || browserPreparationId(actorTerms(evidence,
				row.certificate.abortReason)) !== input.preparationId) refuse('browser abort recovery identity changed')
			if (row.phase === 'committed' || row.phase === 'terminal_pending') {
				try { row = await this.importExact(input.operationId) }
				catch (error) {
					if (!(error instanceof Error) || !error.message.includes('FUNDING_ABORT_TERMINAL_PENDING')) throw error
					row = (await readRow(input.operationId)) ?? refuse('abort row disappeared during terminal recovery')
				}
			}
			return await browserStatus(row, evidence)
		},

		async recoverOnePendingExact() {
			observeAnchor()
			const operations = await options.journal.listRecoverableExact()
			observeAnchor()
			if (operations.length === 0) return 'idle' as const
			const operationId = operations[0]!
			let row = await readRow(operationId)
			if (row === null || row.phase === 'terminal_imported') return 'idle' as const
			if (row.phase === 'signed' || row.phase === 'broadcasting') row = await this.recoverExact(operationId)
			if (row !== null && (row.phase === 'committed' || row.phase === 'terminal_pending')) {
				await this.importExact(operationId)
			}
			return 'recovered' as const
		},

		async requestExact(input: { operationId: string; abortReason: DemoFridayFundingAbortCertificateV1['abortReason'] }) {
			if (options.nostr === undefined) refuse('server-side actor signing is disabled')
			const existing = await readRow(input.operationId)
			if (existing !== null) return structuredClone(existing)
			const { evidence, terms } = await lockedTerms(input.operationId, input.abortReason)
			const actor = await options.nostr.getPublicKey()
			if (actor !== evidence.actor) refuse('NIP-07 actor differs from locked Coco owner')
			const actorAbortEvent = await options.nostr.signEvent(
				demoFridayFundingAbortActorUnsignedEvent(terms, options.nowSeconds()))
			try {
				return structuredClone(await claimAndBroadcast(evidence, terms, actorAbortEvent))
			} catch (error) {
				// Broadcasting is persisted before I/O. An uncertain result is never
				// retried blindly and the locked value remains unavailable.
				throw error
			}
		},

		async recoverExact(operationId: string) {
			let row = await readRow(operationId)
			if (row === null) return null
			if (row.phase === 'signed') return structuredClone(await broadcast(row))
			if (row.phase !== 'broadcasting') return structuredClone(row)
			const recovered = await options.consensus.recoverExact(row.transactionHash)
			if (recovered === null) return structuredClone(row)
			if (recovered.transactionHash !== row.transactionHash) refuse('recovery returned another transaction')
			return structuredClone(await confirm(row, recovered.height))
		},

		async importExact(operationId: string) {
			let row = await readRow(operationId)
			if (row === null || (row.phase !== 'committed' && row.phase !== 'terminal_pending'
				&& row.phase !== 'terminal_imported') || row.commit === undefined) refuse('abort is not committed')
			if (row.phase === 'terminal_imported') return structuredClone(row)
			const commit = row.commit
			if (commit === undefined) refuse('abort commit disappeared')
			const evidence = await options.evidence.readExact(operationId)
			const lockedEvidenceDigest = validateEvidence(evidence, options.pins)
			evidenceMatchesCertificate(evidence, row.certificate)
			if (lockedEvidenceDigest !== row.lockedEvidenceDigest) refuse('locked Coco evidence changed after abort admission')
			if (row.phase === 'committed' || (row.phase === 'terminal_pending'
				&& !HEX_32.test(row.terminalOperationId ?? ''))) row = await transitionRow(row,
				next(row, { phase: 'terminal_pending', terminalOperationId: terminalOperationId(row) }))
			if (!HEX_32.test(row.terminalOperationId ?? '')) refuse('terminal operation identity is missing')
			const terminal = await options.terminal.returnOrRecoverExact({
				terminalOperationId: row.terminalOperationId!, certificate: row.certificate, commit, evidence,
			})
			if (terminal.schema !== 'PLEBEIAN_FRIDAY_FUNDING_ABORT_TERMINAL_RESULT_V1'
				|| terminal.status !== 'recipient_imported' || terminal.operationId !== operationId
				|| terminal.terminalOperationId !== row.terminalOperationId
				|| terminal.abortCertificateDigest !== row.abortCertificateDigest
				|| !HEX_32.test(terminal.recipientAckDigest)) refuse('terminal import differs from committed abort')
			return structuredClone(await transitionRow(row,
				next(row, { phase: 'terminal_imported', terminal })))
		},
	})
}
