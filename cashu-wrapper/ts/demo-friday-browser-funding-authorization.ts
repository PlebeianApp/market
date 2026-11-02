/**
 * Browser-to-authority authorization for the Friday fake-money route.
 *
 * NIP-07 signs this ordinary Nostr event.  It never signs a Cashu message.
 * The separately generated, client-held payment key signs the exact Cashu
 * SIG_ALL return package before this event is accepted.  Binding both public
 * keys and the exact bundle digest here prevents the server from substituting
 * a payment key, auction, amount, mint, operation, or expiry.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

export const DEMO_FRIDAY_FUNDING_AUTH_KIND = 28_647 as const
const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const COMPRESSED_KEY = /^(?:02|03)[0-9a-f]{64}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/
const KEY_AUTH_CONTEXT = utf8ToBytes('PLEBEIAN_FRIDAY_PAYMENT_KEY_AUTHORIZATION_V1')

export interface DemoFridayBrowserFundingAuthorizationContentV1 {
	schema: 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_AUTHORIZATION_V1'
	authNetworkId: string
	chainId: string
	auctionId: string
	amount: number
	mintUrl: string
	paymentPublicKey: string
	refundPublicKey: string
	fundingOperationId: string
	bundleDigest: string
	returnPackageDigest: string
	returnCashuSigAllDigest: string
	bidderReturnSignature: string
	expiresAt: number
	paymentKeyAuthorizationSignature: string
	refundKeyAuthorizationSignature: string
}

export interface DemoFridayBrowserFundingAuthorizationEventV1 {
	id: string
	pubkey: string
	created_at: number
	kind: typeof DEMO_FRIDAY_FUNDING_AUTH_KIND
	tags: string[][]
	content: string
	sig: string
}

export interface DemoFridayBrowserFundingAuthorizationV1 {
	event: DemoFridayBrowserFundingAuthorizationEventV1
	content: DemoFridayBrowserFundingAuthorizationContentV1
}

function refuse(message: string): never { throw new Error(`DEMO_FRIDAY_BROWSER_FUNDING: ${message}`) }

function exactKeys(value: object, expected: string[], label: string): void {
	const actual = Object.keys(value).sort()
	if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) refuse(`${label} has missing or unexpected fields`)
}

function exactText(value: unknown, label: string): string {
	if (typeof value !== 'string' || !ID.test(value)) refuse(`${label} is invalid`)
	return value
}

function exactMint(value: unknown): string {
	if (typeof value !== 'string' || !URL.canParse(value)) refuse('mint URL is invalid')
	const url = new URL(value)
	const hostname = url.hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase()
	if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== ''
		|| url.search !== '' || url.hash !== '' || url.pathname !== '/'
		|| (value !== url.origin && value !== `${url.origin}/`)) {
		refuse('mint URL is not one exact credential-free origin')
	}
	if (url.protocol === 'http:' && hostname !== '127.0.0.1' && hostname !== '::1' && !/^(?:fc|fd)[0-9a-f:]+$/.test(hostname)) {
		refuse('cleartext mint URL is not loopback or a FIPS ULA')
	}
	return value
}

function canonicalContent(value: DemoFridayBrowserFundingAuthorizationContentV1): string {
	return JSON.stringify({
		schema: value.schema, authNetworkId: value.authNetworkId, chainId: value.chainId,
		auctionId: value.auctionId, amount: value.amount, mintUrl: value.mintUrl,
		paymentPublicKey: value.paymentPublicKey, refundPublicKey: value.refundPublicKey,
		fundingOperationId: value.fundingOperationId, bundleDigest: value.bundleDigest,
		returnPackageDigest: value.returnPackageDigest, returnCashuSigAllDigest: value.returnCashuSigAllDigest,
		bidderReturnSignature: value.bidderReturnSignature,
		expiresAt: value.expiresAt, paymentKeyAuthorizationSignature: value.paymentKeyAuthorizationSignature,
		refundKeyAuthorizationSignature: value.refundKeyAuthorizationSignature,
	})
}

export type DemoFridayFundingKeyAuthorizationTermsV1 = Omit<
	DemoFridayBrowserFundingAuthorizationContentV1,
	'paymentKeyAuthorizationSignature' | 'refundKeyAuthorizationSignature'
>

export function demoFridayFundingKeyAuthorizationDigest(
	actor: string,
	value: DemoFridayFundingKeyAuthorizationTermsV1,
): string {
	if (!HEX_32.test(actor)) refuse('actor is invalid')
	const canonical = JSON.stringify({
		schema: value.schema, actor, authNetworkId: value.authNetworkId, chainId: value.chainId,
		auctionId: value.auctionId, amount: value.amount, mintUrl: value.mintUrl,
		paymentPublicKey: value.paymentPublicKey, refundPublicKey: value.refundPublicKey,
		fundingOperationId: value.fundingOperationId, bundleDigest: value.bundleDigest,
		returnPackageDigest: value.returnPackageDigest, returnCashuSigAllDigest: value.returnCashuSigAllDigest,
		bidderReturnSignature: value.bidderReturnSignature, expiresAt: value.expiresAt,
	})
	return bytesToHex(sha256(new Uint8Array([...KEY_AUTH_CONTEXT, ...utf8ToBytes(canonical)])))
}

function verifyKeyAuthorizations(actor: string, content: DemoFridayBrowserFundingAuthorizationContentV1): void {
	const { paymentKeyAuthorizationSignature, refundKeyAuthorizationSignature, ...terms } = content
	const digest = demoFridayFundingKeyAuthorizationDigest(actor, terms)
	if (!schnorr.verify(hexToBytes(paymentKeyAuthorizationSignature), hexToBytes(digest), hexToBytes(content.paymentPublicKey.slice(2)))
		|| !schnorr.verify(hexToBytes(refundKeyAuthorizationSignature), hexToBytes(digest), hexToBytes(content.refundPublicKey.slice(2)))) {
		refuse('payment or refund key proof-of-possession is invalid')
	}
}

export function demoFridayFundingAuthorizationUnsignedEvent(
	actor: string,
	createdAt: number,
	contentValue: DemoFridayBrowserFundingAuthorizationContentV1,
): Omit<DemoFridayBrowserFundingAuthorizationEventV1, 'id' | 'sig'> {
	const content = exactDemoFridayFundingAuthorizationContent(contentValue)
	if (!HEX_32.test(actor) || !Number.isSafeInteger(createdAt) || createdAt < 1) refuse('actor or created_at is invalid')
	verifyKeyAuthorizations(actor, content)
	return {
		pubkey: actor, created_at: createdAt, kind: DEMO_FRIDAY_FUNDING_AUTH_KIND,
		tags: [
			['t', 'plebeian-friday-funding-v1'], ['a', content.auctionId],
			['operation', content.fundingOperationId], ['payment', content.paymentPublicKey],
		],
		content: canonicalContent(content),
	}
}

export function exactDemoFridayFundingAuthorizationContent(value: unknown): DemoFridayBrowserFundingAuthorizationContentV1 {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) refuse('content is not an object')
	const raw = value as Record<string, unknown>
	exactKeys(raw, ['schema', 'authNetworkId', 'chainId', 'auctionId', 'amount', 'mintUrl', 'paymentPublicKey',
		'refundPublicKey', 'fundingOperationId', 'bundleDigest', 'returnPackageDigest', 'returnCashuSigAllDigest',
		'bidderReturnSignature', 'expiresAt',
		'paymentKeyAuthorizationSignature', 'refundKeyAuthorizationSignature'], 'content')
	if (raw.schema !== 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_AUTHORIZATION_V1') refuse('content schema differs')
	const paymentPublicKey = String(raw.paymentPublicKey), refundPublicKey = String(raw.refundPublicKey)
	if (!COMPRESSED_KEY.test(paymentPublicKey) || !COMPRESSED_KEY.test(refundPublicKey)
		|| paymentPublicKey.slice(2) === refundPublicKey.slice(2)) refuse('payment and refund keys are invalid or equal')
	if (!Number.isSafeInteger(raw.amount) || Number(raw.amount) < 1 || Number(raw.amount) > 50_000) refuse('amount is outside fake-money demo bounds')
	if (![raw.bundleDigest, raw.returnPackageDigest, raw.returnCashuSigAllDigest].every((value) => HEX_32.test(String(value)))
		|| !Number.isSafeInteger(raw.expiresAt) || Number(raw.expiresAt) < 1) {
		refuse('bundle/package digest or expiry is invalid')
	}
	if (!HEX_64.test(String(raw.paymentKeyAuthorizationSignature)) || !HEX_64.test(String(raw.refundKeyAuthorizationSignature))
		|| !HEX_64.test(String(raw.bidderReturnSignature))) {
		refuse('payment or refund key authorization signature shape is invalid')
	}
	if (!schnorr.verify(hexToBytes(String(raw.bidderReturnSignature)), hexToBytes(String(raw.returnCashuSigAllDigest)), hexToBytes(paymentPublicKey.slice(2)))) {
		refuse('bidder did not sign the exact Cashu return digest')
	}
	return {
		schema: raw.schema,
		authNetworkId: exactText(raw.authNetworkId, 'auth network'), chainId: exactText(raw.chainId, 'chain'),
		auctionId: exactText(raw.auctionId, 'auction'), amount: Number(raw.amount), mintUrl: exactMint(raw.mintUrl),
		paymentPublicKey, refundPublicKey, fundingOperationId: exactText(raw.fundingOperationId, 'funding operation'),
		bundleDigest: String(raw.bundleDigest), returnPackageDigest: String(raw.returnPackageDigest),
		returnCashuSigAllDigest: String(raw.returnCashuSigAllDigest), bidderReturnSignature: String(raw.bidderReturnSignature),
		expiresAt: Number(raw.expiresAt),
		paymentKeyAuthorizationSignature: String(raw.paymentKeyAuthorizationSignature),
		refundKeyAuthorizationSignature: String(raw.refundKeyAuthorizationSignature),
	}
}

export function verifyDemoFridayBrowserFundingAuthorization(
	value: unknown,
	pins: { authNetworkId: string; chainId: string; mintUrl: string; nowSeconds: number },
): DemoFridayBrowserFundingAuthorizationV1 {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) refuse('event is not an object')
	const event = value as Record<string, unknown>
	exactKeys(event, ['id', 'pubkey', 'created_at', 'kind', 'tags', 'content', 'sig'], 'event')
	if (!HEX_32.test(String(event.id)) || !HEX_32.test(String(event.pubkey)) || !HEX_64.test(String(event.sig))
		|| event.kind !== DEMO_FRIDAY_FUNDING_AUTH_KIND || !Number.isSafeInteger(event.created_at)
		|| typeof event.content !== 'string' || !Array.isArray(event.tags)) refuse('event shape is invalid')
	let parsed: unknown
	try { parsed = JSON.parse(event.content) } catch { refuse('content is not JSON') }
	const content = exactDemoFridayFundingAuthorizationContent(parsed)
	const expected = demoFridayFundingAuthorizationUnsignedEvent(String(event.pubkey), Number(event.created_at), content)
	if (JSON.stringify(event.tags) !== JSON.stringify(expected.tags) || event.content !== expected.content) {
		refuse('event tags or content are noncanonical')
	}
	const id = bytesToHex(sha256(utf8ToBytes(JSON.stringify([
		0, expected.pubkey, expected.created_at, expected.kind, expected.tags, expected.content,
	]))))
	if (event.id !== id || !schnorr.verify(hexToBytes(String(event.sig)), hexToBytes(id), hexToBytes(String(event.pubkey)))) {
		refuse('Nostr event id or signature is invalid')
	}
	if (content.authNetworkId !== pins.authNetworkId || content.chainId !== pins.chainId || content.mintUrl !== pins.mintUrl) {
		refuse('event belongs to another trusted network, chain, or mint')
	}
	if (!Number.isSafeInteger(pins.nowSeconds) || pins.nowSeconds < 1
		|| Math.abs(pins.nowSeconds - Number(event.created_at)) > 300
		|| content.expiresAt < pins.nowSeconds || content.expiresAt < Number(event.created_at)
		|| content.expiresAt - Number(event.created_at) > 300) refuse('event is expired or has an unbounded validity interval')
	return { event: structuredClone(event) as unknown as DemoFridayBrowserFundingAuthorizationEventV1, content }
}
