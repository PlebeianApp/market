/**
 * Consensus-facing, non-bearer admission record for the fake-only integrated
 * FROST/NUT-11 route.  The Cashu proof Y values and package digests are public;
 * bearer secrets and output openings never enter the chain transaction.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

const COMPRESSED_KEY = /^(?:02|03)[0-9a-f]{64}$/
const EVEN_COMPRESSED_KEY = /^02[0-9a-f]{64}$/
const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/
const ADMISSION_SIGNATURE_CONTEXT = utf8ToBytes('COCO_DEMO_FROST_ADMISSION_SIGNATURE_V1')

export interface DemoIntegratedFundingReceiptV2 {
	schema: 'PlebeianAuctionsPOCIntegratedFundingV3'
	auth_network_id: string
	chain_id: string
	mint_url: string
	auction_id: string
	bidder: string
	bid_amount: number
	pool_amount: number
	replaces_bid_id: string
	funding_operation_id: string
	attested_at: number
	expires_at: number
	proof_state_refs: string[]
	active_keyset_id: string
	input_fee_ppk: 0
	locktime: number
	bidder_public_key: string
	refund_public_key: string
	committee_public_key: string
	committee_keyset_id: string
	committee_keyset_version: string
	dkg_run_id: string
	public_key_package_sha256: string
	signer_roster_digest: string
	winner_package_digest: string
	return_package_digest: string
	return_cashu_sigall_digest: string
	bundle_digest: string
	actor_funding_signature: string
	bidder_return_signature: string
	participant_policy_digest: string
	committee_signature: string
}

export type DemoIntegratedFundingReceiptTerms = Omit<
	DemoIntegratedFundingReceiptV2,
	'bundle_digest' | 'actor_funding_signature' | 'participant_policy_digest' | 'committee_signature'
>
export type DemoIntegratedFundingReceiptUnsigned = Omit<
	DemoIntegratedFundingReceiptV2,
	'participant_policy_digest' | 'committee_signature'
>

export class DemoIntegratedFundingReceiptError extends Error {
	constructor(readonly code: string, message: string) {
		super(`${code}: ${message}`)
		this.name = 'DemoIntegratedFundingReceiptError'
	}
}

function refuse(code: string, message: string): never {
	throw new DemoIntegratedFundingReceiptError(code, message)
}

function hashArray(value: unknown[]): string {
	return bytesToHex(sha256(utf8ToBytes(JSON.stringify(value))))
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value)) refuse('DEMO_INTEGRATED_FUNDING_CANONICAL', 'receipt contains a non-safe integer')
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
	if (typeof value !== 'object') refuse('DEMO_INTEGRATED_FUNDING_CANONICAL', 'receipt contains an unsupported value')
	const record = value as Record<string, unknown>
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

function canonicalProofRefs(values: string[]): string[] {
	if (!Array.isArray(values) || values.length === 0 || values.length > 32
		|| values.some((value) => !COMPRESSED_KEY.test(value))
		|| new Set(values.map((value) => value.slice(2))).size !== values.length
		|| JSON.stringify(values) !== JSON.stringify([...values].sort())) {
		refuse('DEMO_INTEGRATED_FUNDING_PROOFS', 'proof references must be distinct, sorted Cashu Y points')
	}
	return [...values]
}

function validMintForReceipt(value: string, mode: 'v3' | 'v4'): boolean {
	if (!URL.canParse(value)) return false
	const url = new URL(value)
	if (mode === 'v3') return url.protocol === 'http:'
	const hostname = url.hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase()
	if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '' || url.pathname !== '/'
		|| (value !== url.origin && value !== `${url.origin}/`)) return false
	if (url.protocol === 'https:') return true
	return url.protocol === 'http:'
		&& (hostname === '127.0.0.1' || hostname === '::1' || /^(?:fc|fd)[0-9a-f:]+$/.test(hostname))
}

/**
 * Validate the fields shared by V3 and V4 without changing either digest.
 * V3 retains its historical HTTP-only test-mint contract.  V4 admits either
 * one exact public HTTPS origin or the loopback/FIPS-ULA HTTP origin used by
 * the isolated lab; arbitrary cleartext hosts remain forbidden.
 */
export function validateDemoIntegratedFundingPublicTerms(
	value: DemoIntegratedFundingReceiptTerms,
	mode: 'v3' | 'v4' = 'v3',
): DemoIntegratedFundingReceiptTerms {
	if (value.schema !== 'PlebeianAuctionsPOCIntegratedFundingV3'
		|| !ID.test(value.auth_network_id) || !ID.test(value.chain_id)
		|| !validMintForReceipt(value.mint_url, mode)
		|| !ID.test(value.auction_id) || !HEX_32.test(value.bidder)
		|| !Number.isSafeInteger(value.bid_amount) || value.bid_amount < 1
		|| !Number.isSafeInteger(value.pool_amount) || value.pool_amount !== value.bid_amount
		|| (value.replaces_bid_id !== '' && !HEX_32.test(value.replaces_bid_id))
		|| !ID.test(value.funding_operation_id) || !Number.isSafeInteger(value.attested_at) || value.attested_at < 1
		|| !Number.isSafeInteger(value.expires_at) || value.expires_at < value.attested_at
		|| value.expires_at - value.attested_at > 300
		|| !ID.test(value.active_keyset_id)
		|| value.input_fee_ppk !== 0 || !Number.isSafeInteger(value.locktime) || value.locktime < 1
		|| !COMPRESSED_KEY.test(value.bidder_public_key) || !COMPRESSED_KEY.test(value.refund_public_key)
		|| !EVEN_COMPRESSED_KEY.test(value.committee_public_key)
		|| new Set([value.bidder_public_key.slice(2), value.refund_public_key.slice(2), value.committee_public_key.slice(2)]).size !== 3
		|| [value.bidder_public_key, value.refund_public_key, value.committee_public_key].some((key) => key.slice(2) === value.bidder)
		|| !ID.test(value.committee_keyset_id) || !ID.test(value.committee_keyset_version) || !ID.test(value.dkg_run_id)
		|| !HEX_32.test(value.public_key_package_sha256) || !HEX_32.test(value.signer_roster_digest)
		|| !HEX_32.test(value.winner_package_digest) || !HEX_32.test(value.return_package_digest)
		|| !HEX_32.test(value.return_cashu_sigall_digest)
		|| !HEX_64.test(value.bidder_return_signature)) {
		refuse('DEMO_INTEGRATED_FUNDING_SHAPE', 'funding receipt public fields are malformed')
	}
	const proof_state_refs = canonicalProofRefs(value.proof_state_refs)
	if (!schnorr.verify(
		hexToBytes(value.bidder_return_signature),
		hexToBytes(value.return_cashu_sigall_digest),
		hexToBytes(value.bidder_public_key.slice(2)),
	)) {
		refuse('DEMO_INTEGRATED_FUNDING_BIDDER', 'bidder did not pre-sign the exact return package')
	}
	return { ...structuredClone(value), proof_state_refs }
}

export function demoIntegratedFundingBundleDigest(value: DemoIntegratedFundingReceiptTerms): string {
	const exact = validateDemoIntegratedFundingPublicTerms(value)
	return hashArray([
		'PlebeianAuctionsPOCIntegratedFundingBundleV3', exact.auth_network_id, exact.chain_id,
		exact.mint_url, exact.auction_id, exact.bidder,
		exact.bid_amount, exact.pool_amount, exact.replaces_bid_id, exact.funding_operation_id, exact.attested_at, exact.expires_at, exact.proof_state_refs,
		exact.active_keyset_id, exact.input_fee_ppk, exact.locktime, exact.bidder_public_key,
		exact.refund_public_key, exact.committee_public_key, exact.committee_keyset_id,
		exact.committee_keyset_version, exact.dkg_run_id, exact.public_key_package_sha256, exact.signer_roster_digest,
		exact.winner_package_digest, exact.return_package_digest,
		exact.return_cashu_sigall_digest,
	])
}

export function demoIntegratedFundingReceiptDigest(value: DemoIntegratedFundingReceiptUnsigned): string {
	const { bundle_digest, actor_funding_signature, ...terms } = value
	const exact = validateDemoIntegratedFundingPublicTerms(terms)
	if (!HEX_32.test(bundle_digest) || bundle_digest !== demoIntegratedFundingBundleDigest(exact)) {
		refuse('DEMO_INTEGRATED_FUNDING_BUNDLE', 'bundle digest is not canonical')
	}
	if (!HEX_64.test(actor_funding_signature)
		|| !schnorr.verify(hexToBytes(actor_funding_signature), hexToBytes(bundle_digest), hexToBytes(exact.bidder))) {
		refuse('DEMO_INTEGRATED_FUNDING_ACTOR', 'auction actor did not approve the exact funding bundle')
	}
	return hashArray([
		exact.schema, exact.auth_network_id, exact.chain_id, exact.mint_url, exact.auction_id, exact.bidder, exact.bid_amount,
		exact.pool_amount, exact.replaces_bid_id, exact.funding_operation_id, exact.attested_at, exact.expires_at, exact.proof_state_refs, exact.active_keyset_id,
		exact.input_fee_ppk, exact.locktime, exact.bidder_public_key, exact.refund_public_key,
		exact.committee_public_key, exact.committee_keyset_id, exact.committee_keyset_version,
		exact.dkg_run_id, exact.public_key_package_sha256, exact.signer_roster_digest,
		exact.winner_package_digest, exact.return_package_digest, exact.return_cashu_sigall_digest,
		bundle_digest,
		actor_funding_signature,
		exact.bidder_return_signature,
	])
}

/** Domain-separated message signed only by the admission-receipt FROST command. */
export function demoIntegratedFundingAdmissionSignatureDigest(
	value: DemoIntegratedFundingReceiptUnsigned,
	participantPolicyDigest: string,
): string {
	if (!HEX_32.test(participantPolicyDigest)) {
		refuse('DEMO_INTEGRATED_FUNDING_POLICY', 'participant policy digest is malformed')
	}
	return bytesToHex(sha256(concatBytes(
		ADMISSION_SIGNATURE_CONTEXT,
		hexToBytes(demoIntegratedFundingReceiptDigest(value)),
		hexToBytes(participantPolicyDigest),
	)))
}

/** Exact deterministic unsigned receipt bytes bound by the admission-only FROST domain. */
export function demoIntegratedFundingReceiptCanonicalBytes(
	value: DemoIntegratedFundingReceiptUnsigned,
): Uint8Array {
	const exact = structuredClone(value)
	// Revalidate all signatures/digests before any bytes reach a signer.
	demoIntegratedFundingReceiptDigest(exact)
	return utf8ToBytes(canonicalJson(exact))
}

export function prepareDemoIntegratedFundingReceipt(
	value: DemoIntegratedFundingReceiptTerms,
	actorFundingSignature: string,
): DemoIntegratedFundingReceiptUnsigned {
	const exact = validateDemoIntegratedFundingPublicTerms(value)
	const bundle_digest = demoIntegratedFundingBundleDigest(exact)
	const unsigned = { ...exact, bundle_digest, actor_funding_signature: actorFundingSignature }
	// The receipt digest performs the exact actor-signature check.
	demoIntegratedFundingReceiptDigest(unsigned)
	return unsigned
}

export function finalizeDemoIntegratedFundingReceipt(
	value: DemoIntegratedFundingReceiptUnsigned,
	participantPolicyDigest: string,
	committeeSignature: string,
): DemoIntegratedFundingReceiptV2 {
	const exact = structuredClone(value)
	const digest = demoIntegratedFundingAdmissionSignatureDigest(exact, participantPolicyDigest)
	if (!HEX_64.test(committeeSignature) || !schnorr.verify(
		hexToBytes(committeeSignature),
		hexToBytes(digest),
		hexToBytes(exact.committee_public_key.slice(2)),
	)) {
		refuse('DEMO_INTEGRATED_FUNDING_COMMITTEE', 'threshold committee signature is invalid')
	}
	return { ...exact, participant_policy_digest: participantPolicyDigest, committee_signature: committeeSignature }
}

/** Verify and clone a complete threshold-signed admission receipt. */
export function verifyDemoIntegratedFundingReceipt(value: DemoIntegratedFundingReceiptV2): DemoIntegratedFundingReceiptV2 {
	const exact = structuredClone(value)
	const { committee_signature, participant_policy_digest, ...unsigned } = exact
	const digest = demoIntegratedFundingAdmissionSignatureDigest(unsigned, participant_policy_digest)
	if (!HEX_64.test(committee_signature) || !schnorr.verify(
		hexToBytes(committee_signature),
		hexToBytes(digest),
		hexToBytes(exact.committee_public_key.slice(2)),
	)) {
		refuse('DEMO_INTEGRATED_FUNDING_COMMITTEE', 'threshold committee signature is invalid')
	}
	return exact
}

