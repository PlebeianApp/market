/** V4 admission receipt: exact Nostr funding authorization, never a relabelled raw actor signature. */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	verifyDemoFridayBrowserFundingAuthorization,
	type DemoFridayBrowserFundingAuthorizationEventV1,
} from './demo-friday-browser-funding-authorization'
import {
	validateDemoIntegratedFundingPublicTerms,
	type DemoIntegratedFundingReceiptTerms,
} from './demo-integrated-funding-receipt'

const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const ADMISSION_SIGNATURE_CONTEXT = utf8ToBytes('COCO_DEMO_FROST_ADMISSION_SIGNATURE_V1')
const EXACT_RECEIPT_KEYS = [
	'active_keyset_id', 'actor_funding_authorization', 'attested_at', 'auction_id', 'auth_network_id', 'bid_amount',
	'bidder', 'bidder_public_key', 'bidder_return_signature', 'bundle_digest', 'chain_id',
	'committee_keyset_id', 'committee_keyset_version', 'committee_public_key', 'committee_signature',
	'dkg_run_id', 'expires_at', 'funding_operation_id', 'input_fee_ppk', 'locktime', 'mint_url',
	'participant_policy_digest', 'pool_amount', 'prepared_bundle_digest', 'proof_state_refs',
	'public_key_package_sha256', 'refund_public_key', 'replaces_bid_id', 'return_cashu_sigall_digest',
	'return_package_digest', 'schema', 'signer_roster_digest', 'winner_package_digest',
] as const

export type DemoIntegratedFundingReceiptV4Terms = Omit<
	DemoIntegratedFundingReceiptTerms,
	'schema'
> & {
	schema: 'PlebeianAuctionsPOCIntegratedFundingV4'
	prepared_bundle_digest: string
	actor_funding_authorization: DemoFridayBrowserFundingAuthorizationEventV1
}

export type DemoIntegratedFundingReceiptV4Unsigned = DemoIntegratedFundingReceiptV4Terms & {
	bundle_digest: string
}

export type DemoIntegratedFundingReceiptV4 = DemoIntegratedFundingReceiptV4Unsigned & {
	participant_policy_digest: string
	committee_signature: string
}

function refuse(message: string): never { throw new Error(`DEMO_INTEGRATED_FUNDING_V4: ${message}`) }
function hash(value: unknown): string { return bytesToHex(sha256(utf8ToBytes(JSON.stringify(value)))) }

function canonicalJson(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') { if (!Number.isSafeInteger(value)) refuse('non-safe integer'); return JSON.stringify(value) }
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
	if (typeof value !== 'object') refuse('unsupported canonical value')
	const record = value as Record<string, unknown>
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

function publicTerms(value: DemoIntegratedFundingReceiptV4Terms): DemoIntegratedFundingReceiptTerms {
	const { prepared_bundle_digest: _prepared, actor_funding_authorization: _authorization, schema: _schema, ...rest } = value
	return { ...structuredClone(rest), schema: 'PlebeianAuctionsPOCIntegratedFundingV3' }
}

export function demoIntegratedFundingV4BundleDigest(value: DemoIntegratedFundingReceiptV4Terms): string {
	if (value.schema !== 'PlebeianAuctionsPOCIntegratedFundingV4' || !HEX_32.test(value.prepared_bundle_digest)) refuse('schema or prepared bundle digest differs')
	const publicValue = publicTerms(value)
	// Reuse the frozen shared-field validator in V4 mint-origin mode.  The V3
	// digest is deliberately not computed: V4 has its own framing below.
	validateDemoIntegratedFundingPublicTerms(publicValue, 'v4')
	const authorization = verifyDemoFridayBrowserFundingAuthorization(value.actor_funding_authorization, {
		authNetworkId: value.auth_network_id, chainId: value.chain_id,
		mintUrl: value.mint_url, nowSeconds: value.attested_at,
	})
	const content = authorization.content
	const bindings: Array<[string, unknown, unknown]> = [
		['actor', authorization.event.pubkey, value.bidder], ['auction', content.auctionId, value.auction_id],
		['amount', content.amount, value.pool_amount], ['operation', content.fundingOperationId, value.funding_operation_id],
		['payment key', content.paymentPublicKey, value.bidder_public_key], ['refund key', content.refundPublicKey, value.refund_public_key],
		['prepared bundle', content.bundleDigest, value.prepared_bundle_digest],
		['return package', content.returnPackageDigest, value.return_package_digest],
		['return SIG_ALL', content.returnCashuSigAllDigest, value.return_cashu_sigall_digest],
		['bidder return signature', content.bidderReturnSignature, value.bidder_return_signature],
		['expiry', content.expiresAt, value.expires_at], ['attestation time', authorization.event.created_at, value.attested_at],
	]
	const mismatch = bindings.find(([, actual, expected]) => actual !== expected)
	if (mismatch !== undefined) refuse(`Nostr authorization differs at ${mismatch[0]}`)
	return hash([
		'PlebeianAuctionsPOCIntegratedFundingBundleV4', value.auth_network_id, value.chain_id,
		value.mint_url, value.auction_id, value.bidder, value.bid_amount, value.pool_amount,
		value.replaces_bid_id, value.funding_operation_id, value.attested_at, value.expires_at,
		value.proof_state_refs, value.active_keyset_id, value.input_fee_ppk, value.locktime,
		value.bidder_public_key, value.refund_public_key, value.committee_public_key,
		value.committee_keyset_id, value.committee_keyset_version, value.dkg_run_id,
		value.public_key_package_sha256, value.signer_roster_digest,
		value.winner_package_digest, value.return_package_digest, value.return_cashu_sigall_digest,
		value.prepared_bundle_digest,
	])
}

export function demoIntegratedFundingV4ReceiptDigest(value: DemoIntegratedFundingReceiptV4Unsigned): string {
	const { bundle_digest, ...terms } = value
	const expected = demoIntegratedFundingV4BundleDigest(terms)
	if (bundle_digest !== expected) refuse('integrated bundle digest is noncanonical')
	return hash([
		terms.schema, terms.auth_network_id, terms.chain_id, terms.mint_url, terms.auction_id,
		terms.bidder, terms.bid_amount, terms.pool_amount, terms.replaces_bid_id,
		terms.funding_operation_id, terms.attested_at, terms.expires_at, terms.proof_state_refs,
		terms.active_keyset_id, terms.input_fee_ppk, terms.locktime, terms.bidder_public_key,
		terms.refund_public_key, terms.committee_public_key, terms.committee_keyset_id,
		terms.committee_keyset_version, terms.dkg_run_id, terms.public_key_package_sha256,
		terms.signer_roster_digest, terms.winner_package_digest, terms.return_package_digest,
		terms.return_cashu_sigall_digest, terms.prepared_bundle_digest, bundle_digest,
		terms.actor_funding_authorization.id, terms.bidder_return_signature,
	])
}

export function demoIntegratedFundingV4CanonicalBytes(value: DemoIntegratedFundingReceiptV4Unsigned): Uint8Array {
	demoIntegratedFundingV4ReceiptDigest(value)
	return utf8ToBytes(canonicalJson(structuredClone(value)))
}

export function demoIntegratedFundingV4AdmissionSignatureDigest(
	value: DemoIntegratedFundingReceiptV4Unsigned,
	participantPolicyDigest: string,
): string {
	if (!HEX_32.test(participantPolicyDigest)) refuse('participant policy digest is malformed')
	return bytesToHex(sha256(concatBytes(
		ADMISSION_SIGNATURE_CONTEXT,
		hexToBytes(demoIntegratedFundingV4ReceiptDigest(value)),
		hexToBytes(participantPolicyDigest),
	)))
}

export function prepareDemoIntegratedFundingReceiptV4(
	value: DemoIntegratedFundingReceiptV4Terms,
): DemoIntegratedFundingReceiptV4Unsigned {
	const exact = structuredClone(value)
	const unsigned = { ...exact, bundle_digest: demoIntegratedFundingV4BundleDigest(exact) }
	demoIntegratedFundingV4ReceiptDigest(unsigned)
	return unsigned
}

export function finalizeDemoIntegratedFundingReceiptV4(
	value: DemoIntegratedFundingReceiptV4Unsigned,
	participantPolicyDigest: string,
	committeeSignature: string,
): DemoIntegratedFundingReceiptV4 {
	const digest = demoIntegratedFundingV4AdmissionSignatureDigest(value, participantPolicyDigest)
	if (!HEX_64.test(committeeSignature) || !schnorr.verify(
		hexToBytes(committeeSignature), hexToBytes(digest), hexToBytes(value.committee_public_key.slice(2)),
	)) refuse('threshold committee signature is invalid')
	return { ...structuredClone(value), participant_policy_digest: participantPolicyDigest, committee_signature: committeeSignature }
}

export function verifyDemoIntegratedFundingReceiptV4(value: DemoIntegratedFundingReceiptV4): DemoIntegratedFundingReceiptV4 {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...EXACT_RECEIPT_KEYS].sort())) {
		refuse('receipt has missing or unexpected fields')
	}
	const { participant_policy_digest, committee_signature, ...unsigned } = structuredClone(value)
	return finalizeDemoIntegratedFundingReceiptV4(unsigned, participant_policy_digest, committee_signature)
}
