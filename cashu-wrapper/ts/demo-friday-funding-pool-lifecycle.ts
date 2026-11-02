/**
 * INERT FundingAbortV1 consensus contract for the Friday fake-money demo.
 *
 * A coordinator journal, missing transaction, or elapsed wall clock is never
 * authority.  A future Comet adapter must commit exactly one of a bid or an
 * abort and persist the operation/proof-Y tombstone in consensus state.
 *
 * A committed abort is not mint-spend authority.  Returning value still
 * requires authenticated H/H+1/H+2 finality, reconstruction of the exact
 * admitted return package from the durable Coco locked token, NUT-07 UNSPENT
 * evidence, a separate FROST SIG_ALL authorization, recipient import and ack.
 * Failures before either consensus event remain emergency-only; the unilateral
 * emergency MAIN/refund first-spend race is deliberately unresolved here.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const COMPRESSED = /^(?:02|03)[0-9a-f]{64}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/
const COMMITTEE_DOMAIN = utf8ToBytes('PLEBEIAN_FRIDAY_FUNDING_ABORT_COMMITTEE_V1')
const ABORT_EVENT_KIND = 28650

function refuse(message: string): never { throw new Error(`DEMO_FRIDAY_FUNDING_ABORT: ${message}`) }
function exactKeys(value: object, expected: string[], label: string): void {
	if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) refuse(`${label} fields differ`)
}
function canonical(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value)) refuse('non-safe integer')
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
	if (typeof value !== 'object') refuse('unsupported canonical value')
	const record = value as Record<string, unknown>
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}
function framedDigest(domain: Uint8Array, value: unknown): string {
	return bytesToHex(sha256(new Uint8Array([...domain, ...utf8ToBytes(canonical(value))])))
}
function verify(signature: string, digest: string, publicKey: string): boolean {
	try {
		return HEX_64.test(signature) && HEX_32.test(digest)
			&& schnorr.verify(hexToBytes(signature), hexToBytes(digest), hexToBytes(publicKey.replace(/^(?:02|03)/, '')))
	} catch { return false }
}

export interface DemoFridayFundingAbortCertificateV1 {
	schema: 'PLEBEIAN_FRIDAY_FUNDING_ABORT_V1'
	authNetworkId: string
	chainId: string
	genesisSha256: string
	auctionId: string
	operationId: string
	actor: string
	mintUrl: string
	activeKeysetId: string
	amount: number
	proofYs: string[]
	poolDigest: string
	nut11LockPublicKeys: [string, string]
	locktime: number
	paymentPublicKey: string
	refundPublicKey: string
	committeePublicKey: string
	returnPackageDigest: string
	returnCashuSigAllDigest: string
	bidderReturnSignature: string
	fundingAuthorizationEventId: string
	abortNotBefore: number
	abortExpiresAt: number
	abortReason: 'prebroadcast_client_abandonment' | 'prebroadcast_service_failure'
	committeeKeysetId: string
	committeeKeysetVersion: string
	dkgRunId: string
	publicKeyPackageSha256: string
	signerRosterDigest: string
	participantPolicyDigest: string
	actorAbortEvent: DemoFridayFundingAbortNostrEventV1
	committeeAbortSignature: string
}

export interface DemoFridayFundingAbortNostrEventV1 {
	id: string
	pubkey: string
	created_at: number
	kind: typeof ABORT_EVENT_KIND
	tags: string[][]
	content: string
	sig: string
}

export interface DemoFridayCommittedBidClaimV1 {
	schema: 'PLEBEIAN_FRIDAY_COMMITTED_BID_CLAIM_V1'
	operationId: string
	proofYs: string[]
	auctionId: string
	actor: string
	amount: number
	eventId: string
	status: 'active' | 'rejected_return_entitled'
	rejectionReason?: 'auction_not_open' | 'seller_self_bid' | 'late' | 'below_minimum' | 'stale_leader' | 'funding_expired'
}

export interface DemoFridayFundingLifecycleRecordV1 {
	schema: 'PLEBEIAN_FRIDAY_FUNDING_LIFECYCLE_RECORD_V1'
	operationId: string
	proofYs: string[]
	auctionId: string
	actor: string
	amount: number
	origin: 'committed_bid' | 'committed_abort'
	status: 'active' | 'rejected_return_entitled' | 'aborted_return_entitled'
	consensusEventId: string
	committedHeight: number
	committedAt: number
	reason?: string
	abortCertificateDigest?: string
}

export interface DemoFridayFundingLifecycleStateV1 {
	schema: 'PLEBEIAN_FRIDAY_FUNDING_LIFECYCLE_STATE_V1'
	records: Record<string, DemoFridayFundingLifecycleRecordV1>
	proofOwners: Record<string, string>
}

export interface DemoFridayFundingAbortPinsV1 {
	authNetworkId: string
	chainId: string
	genesisSha256: string
	mintUrl: string
	activeKeysetId: string
	committeePublicKey: string
	committeeKeysetId: string
	committeeKeysetVersion: string
	dkgRunId: string
	publicKeyPackageSha256: string
	signerRosterDigest: string
}

type ActorUnsigned = Omit<DemoFridayFundingAbortCertificateV1,
	'participantPolicyDigest' | 'actorAbortEvent' | 'committeeAbortSignature'>
type CommitteeUnsigned = Omit<DemoFridayFundingAbortCertificateV1, 'committeeAbortSignature'>

export function demoFridayFundingAbortActorUnsignedEvent(
	value: ActorUnsigned,
	createdAt: number,
): Omit<DemoFridayFundingAbortNostrEventV1, 'id' | 'sig'> {
	if (!Number.isSafeInteger(createdAt) || createdAt < 1 || createdAt > value.abortExpiresAt) {
		refuse('actor abort event time is invalid')
	}
	const { schema: _certificateSchema, ...terms } = value
	return {
		pubkey: value.actor,
		created_at: createdAt,
		kind: ABORT_EVENT_KIND,
		tags: [['t', 'plebeian-friday-funding-abort-v1'], ['a', value.auctionId], ['operation', value.operationId]],
		content: canonical({ schema: 'PLEBEIAN_FRIDAY_FUNDING_ABORT_ACTOR_TERMS_V1', ...terms }),
	}
}

export function demoFridayFundingAbortCommitteeDigest(value: CommitteeUnsigned): string {
	return framedDigest(COMMITTEE_DOMAIN, value)
}

function exactAbortCertificate(
	value: unknown,
	pins: DemoFridayFundingAbortPinsV1,
	committedAt: number,
): { certificate: DemoFridayFundingAbortCertificateV1; digest: string } {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) refuse('certificate is not an object')
	const raw = value as Record<string, unknown>
	exactKeys(raw, ['schema', 'authNetworkId', 'chainId', 'genesisSha256', 'auctionId', 'operationId', 'actor',
		'mintUrl', 'activeKeysetId', 'amount', 'proofYs', 'poolDigest', 'nut11LockPublicKeys', 'locktime',
		'paymentPublicKey', 'refundPublicKey', 'committeePublicKey', 'returnPackageDigest',
		'returnCashuSigAllDigest', 'bidderReturnSignature', 'fundingAuthorizationEventId', 'abortNotBefore',
		'abortExpiresAt', 'abortReason', 'committeeKeysetId', 'committeeKeysetVersion', 'dkgRunId',
		'publicKeyPackageSha256', 'signerRosterDigest', 'participantPolicyDigest', 'actorAbortEvent',
		'committeeAbortSignature'], 'certificate')
	const exact = structuredClone(value) as DemoFridayFundingAbortCertificateV1
	if (exact.schema !== 'PLEBEIAN_FRIDAY_FUNDING_ABORT_V1' || !ID.test(exact.operationId)
		|| !ID.test(exact.auctionId) || !ID.test(exact.activeKeysetId) || !ID.test(exact.committeeKeysetId)
		|| !ID.test(exact.committeeKeysetVersion) || !ID.test(exact.dkgRunId) || !HEX_32.test(exact.actor)
		|| !Number.isSafeInteger(exact.amount) || exact.amount < 1 || exact.amount > 50_000
		|| !Number.isSafeInteger(exact.locktime) || exact.locktime < 1 || !Number.isSafeInteger(exact.abortNotBefore)
		|| !Number.isSafeInteger(exact.abortExpiresAt) || exact.abortNotBefore < 1
		|| exact.abortExpiresAt < exact.abortNotBefore || exact.abortExpiresAt - exact.abortNotBefore > 4_200
		|| exact.locktime < exact.abortExpiresAt
		|| !Number.isSafeInteger(committedAt) || committedAt < exact.abortNotBefore || committedAt > exact.abortExpiresAt
		|| !Array.isArray(exact.proofYs) || exact.proofYs.length < 1 || exact.proofYs.length > 32
		|| exact.proofYs.some((proof, index) => !COMPRESSED.test(proof)
			|| (index > 0 && exact.proofYs[index - 1]! >= proof))) {
		refuse('certificate identity, amount, validity, or proof set is invalid')
	}
	if (!Array.isArray(exact.nut11LockPublicKeys) || exact.nut11LockPublicKeys.length !== 2
		|| !COMPRESSED.test(exact.paymentPublicKey) || !COMPRESSED.test(exact.refundPublicKey)
		|| !COMPRESSED.test(exact.committeePublicKey)
		|| exact.nut11LockPublicKeys[0] !== exact.paymentPublicKey
		|| exact.nut11LockPublicKeys[1] !== exact.committeePublicKey
		|| new Set([exact.paymentPublicKey, exact.refundPublicKey, exact.committeePublicKey]).size !== 3
		|| new Set([exact.actor, exact.paymentPublicKey.slice(2), exact.refundPublicKey.slice(2),
			exact.committeePublicKey.slice(2)]).size !== 4) {
		refuse('NUT-11 or role key identity is invalid')
	}
	if (!['prebroadcast_client_abandonment', 'prebroadcast_service_failure'].includes(exact.abortReason)) {
		refuse('abort reason is invalid')
	}
	if (exact.authNetworkId !== pins.authNetworkId || exact.chainId !== pins.chainId
		|| exact.genesisSha256 !== pins.genesisSha256 || exact.mintUrl !== pins.mintUrl
		|| exact.activeKeysetId !== pins.activeKeysetId || exact.committeePublicKey !== pins.committeePublicKey
		|| exact.committeeKeysetId !== pins.committeeKeysetId
		|| exact.committeeKeysetVersion !== pins.committeeKeysetVersion || exact.dkgRunId !== pins.dkgRunId
		|| exact.publicKeyPackageSha256 !== pins.publicKeyPackageSha256
		|| exact.signerRosterDigest !== pins.signerRosterDigest) refuse('certificate differs from fixed deployment pins')
	for (const digest of [exact.genesisSha256, exact.poolDigest, exact.returnPackageDigest,
		exact.returnCashuSigAllDigest, exact.fundingAuthorizationEventId, exact.publicKeyPackageSha256,
		exact.signerRosterDigest, exact.participantPolicyDigest]) {
		if (!HEX_32.test(digest)) refuse('certificate digest is malformed')
	}
	if (!verify(exact.bidderReturnSignature, exact.returnCashuSigAllDigest, exact.paymentPublicKey)) {
		refuse('bidder return signature differs from the exact Cashu return')
	}
	const { participantPolicyDigest: _policy, actorAbortEvent, committeeAbortSignature, ...actorUnsigned } = exact
	if (actorAbortEvent === null || typeof actorAbortEvent !== 'object' || Array.isArray(actorAbortEvent)) {
		refuse('actor abort authorization is not a Nostr event')
	}
	exactKeys(actorAbortEvent, ['id', 'pubkey', 'created_at', 'kind', 'tags', 'content', 'sig'], 'actor abort event')
	const expectedActorEvent = demoFridayFundingAbortActorUnsignedEvent(actorUnsigned, actorAbortEvent.created_at)
	const actorEventId = bytesToHex(sha256(utf8ToBytes(JSON.stringify([
		0, expectedActorEvent.pubkey, expectedActorEvent.created_at, expectedActorEvent.kind,
		expectedActorEvent.tags, expectedActorEvent.content,
	]))))
	if (actorAbortEvent.id !== actorEventId || actorAbortEvent.pubkey !== expectedActorEvent.pubkey
		|| actorAbortEvent.kind !== expectedActorEvent.kind || actorAbortEvent.created_at !== expectedActorEvent.created_at
		|| canonical(actorAbortEvent.tags) !== canonical(expectedActorEvent.tags)
		|| actorAbortEvent.content !== expectedActorEvent.content || !HEX_64.test(actorAbortEvent.sig)
		|| !verify(actorAbortEvent.sig, actorAbortEvent.id, exact.actor)) {
		refuse('actor did not authorize the exact abort Nostr event')
	}
	const { committeeAbortSignature: _signature, ...committeeUnsigned } = exact
	if (!verify(committeeAbortSignature, demoFridayFundingAbortCommitteeDigest(committeeUnsigned), exact.committeePublicKey)) {
		refuse('committee did not authorize the exact abort domain')
	}
	return { certificate: exact, digest: bytesToHex(sha256(utf8ToBytes(canonical(exact)))) }
}

export function emptyDemoFridayFundingLifecycleState(): DemoFridayFundingLifecycleStateV1 {
	return { schema: 'PLEBEIAN_FRIDAY_FUNDING_LIFECYCLE_STATE_V1', records: {}, proofOwners: {} }
}

function claim(
	state: DemoFridayFundingLifecycleStateV1,
	record: DemoFridayFundingLifecycleRecordV1,
): DemoFridayFundingLifecycleStateV1 {
	if (state.schema !== 'PLEBEIAN_FRIDAY_FUNDING_LIFECYCLE_STATE_V1') refuse('state schema is invalid')
	if (state.records[record.operationId]) refuse('operation already has a committed lifecycle origin')
	for (const proofY of record.proofYs) {
		if (state.proofOwners[proofY]) refuse('proof already belongs to a committed lifecycle origin')
	}
	const next = structuredClone(state)
	next.records[record.operationId] = record
	for (const proofY of record.proofYs) next.proofOwners[proofY] = record.operationId
	return next
}

/**
 * The caller must first authenticate the ordinary committed bid/receipt and its
 * exact proof set.  This transition supplies only the consensus-global
 * operation/proof-Y exclusion shared with FundingAbortV1.
 */
export function claimDemoFridayCommittedBid(
	state: DemoFridayFundingLifecycleStateV1,
	claimValue: DemoFridayCommittedBidClaimV1,
	committedHeight: number,
	committedAt: number,
): DemoFridayFundingLifecycleStateV1 {
	exactKeys(claimValue as unknown as object, claimValue.status === 'active'
		? ['schema', 'operationId', 'proofYs', 'auctionId', 'actor', 'amount', 'eventId', 'status']
		: ['schema', 'operationId', 'proofYs', 'auctionId', 'actor', 'amount', 'eventId', 'status', 'rejectionReason'],
	'committed bid claim')
	if (claimValue.schema !== 'PLEBEIAN_FRIDAY_COMMITTED_BID_CLAIM_V1' || !ID.test(claimValue.operationId)
		|| !ID.test(claimValue.auctionId) || !HEX_32.test(claimValue.actor) || !HEX_32.test(claimValue.eventId)
		|| !Number.isSafeInteger(claimValue.amount) || claimValue.amount < 1 || claimValue.amount > 50_000
		|| !Number.isSafeInteger(committedHeight) || committedHeight < 1 || !Number.isSafeInteger(committedAt)
		|| committedAt < 1 || !['active', 'rejected_return_entitled'].includes(claimValue.status)
		|| !Array.isArray(claimValue.proofYs) || claimValue.proofYs.length < 1
		|| claimValue.proofYs.length > 32 || claimValue.proofYs.some((proof, index) => !COMPRESSED.test(proof)
			|| (index > 0 && claimValue.proofYs[index - 1]! >= proof))) refuse('committed bid claim is invalid')
	if (claimValue.status === 'active' && claimValue.rejectionReason !== undefined) refuse('active bid has rejection reason')
	if (claimValue.status === 'rejected_return_entitled'
		&& !['auction_not_open', 'seller_self_bid', 'late', 'below_minimum', 'stale_leader', 'funding_expired']
			.includes(claimValue.rejectionReason ?? '')) refuse('business rejection reason is invalid')
	return claim(state, {
		schema: 'PLEBEIAN_FRIDAY_FUNDING_LIFECYCLE_RECORD_V1', operationId: claimValue.operationId,
		proofYs: structuredClone(claimValue.proofYs), auctionId: claimValue.auctionId, actor: claimValue.actor,
		amount: claimValue.amount, origin: 'committed_bid', status: claimValue.status,
		consensusEventId: claimValue.eventId, committedHeight, committedAt, reason: claimValue.rejectionReason,
	})
}

export function claimDemoFridayCommittedAbort(
	state: DemoFridayFundingLifecycleStateV1,
	value: unknown,
	pins: DemoFridayFundingAbortPinsV1,
	consensusEventId: string,
	committedHeight: number,
	committedAt: number,
): DemoFridayFundingLifecycleStateV1 {
	if (!HEX_32.test(consensusEventId) || !Number.isSafeInteger(committedHeight) || committedHeight < 1) {
		refuse('committed abort identity is invalid')
	}
	const { certificate, digest } = exactAbortCertificate(value, pins, committedAt)
	return claim(state, {
		schema: 'PLEBEIAN_FRIDAY_FUNDING_LIFECYCLE_RECORD_V1', operationId: certificate.operationId,
		proofYs: structuredClone(certificate.proofYs), auctionId: certificate.auctionId, actor: certificate.actor,
		amount: certificate.amount, origin: 'committed_abort', status: 'aborted_return_entitled',
		consensusEventId, committedHeight, committedAt, reason: certificate.abortReason,
		abortCertificateDigest: digest,
	})
}
