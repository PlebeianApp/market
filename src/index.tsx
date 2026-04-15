import { serve } from 'bun'
import { config } from 'dotenv'
import { Relay } from 'nostr-tools'
import { getPublicKey, verifyEvent, type Event } from 'nostr-tools/pure'
import NDK, { NDKKind } from '@nostr-dev-kit/ndk'
import { bech32 } from '@scure/base'
import { secp256k1 } from '@noble/curves/secp256k1'
import { bytesToHex } from '@noble/hashes/utils'
import index from './index.html'
import { fetchAppSettings } from './lib/appSettings'
import {
	AUCTION_BID_KIND,
	AUCTION_SETTLEMENT_KIND,
	buildActiveAuctionBidChains,
	compareAuctionBidChainPriority,
	getAuctionBidAmount,
	getAuctionEndAt,
	getAuctionReserveAmount,
	getAuctionTagValue,
	type AuctionSettlementPlanResponse,
	type AuctionSettlementPublishStatus,
} from './lib/auctionSettlement'
import { auctionP2pkPubkeysMatch, inspectAuctionP2pkPubkey, inspectAuctionP2pkSecret, normalizeAuctionP2pkPubkey } from './lib/auctionP2pk'
import { AUCTION_BID_TOKEN_TOPIC, parseAuctionBidTokenEnvelope } from './lib/auctionTransfers'
import { AppSettingsSchema } from './lib/schemas/app'
import { getEventHandler } from './server'
import { ZapInvoiceError } from './server/ZapPurchaseManager'
import type { ZapPurchaseInvoiceRequestBody } from './server/ZapPurchaseManager'
import { join } from 'path'
import { file } from 'bun'
import { CashuMint, getDecodedToken, getEncodedToken, getTokenMetadata, type MintKeyset } from '@cashu/cashu-ts'
import { NDKEvent, NDKPrivateKeySigner, NDKUser } from '@nostr-dev-kit/ndk'

import.meta.hot.accept()

config()

const RELAY_URL = process.env.APP_RELAY_URL
const NIP46_RELAY_URL = process.env.NIP46_RELAY_URL || 'wss://relay.nsec.app'
const APP_PRIVATE_KEY = process.env.APP_PRIVATE_KEY

let appSettings: Awaited<ReturnType<typeof fetchAppSettings>> = null
let APP_PUBLIC_KEY: string
let APP_CASHU_PUBLIC_KEY: string
let CVM_SERVER_PUBKEY: string

let invoiceNdk: NDK | null = null
let invoiceNdkConnectPromise: Promise<void> | null = null
let cachedAppLightningIdentifier: { value: string; fetchedAtMs: number } | null = null
let appAuctionSigner: NDKPrivateKeySigner | null = null
const mintKeysetCache = new Map<string, MintKeyset[]>()

function jsonError(message: string, status = 400) {
	return Response.json({ error: message }, { status })
}

const sha256Hex = async (value: string): Promise<string> => {
	const encoded = new TextEncoder().encode(value)
	const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded)
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')
}

const normalizeMintUrl = (mintUrl: string): string => mintUrl.trim().replace(/\/$/, '')

function getAppPublicKeyOrThrow(): string {
	if (APP_PUBLIC_KEY) return APP_PUBLIC_KEY
	if (!APP_PRIVATE_KEY) throw new Error('Missing APP_PRIVATE_KEY')

	const privateKeyBytes = new Uint8Array(Buffer.from(APP_PRIVATE_KEY, 'hex'))
	APP_PUBLIC_KEY = getPublicKey(privateKeyBytes)
	return APP_PUBLIC_KEY
}

function getAppCashuPublicKeyOrThrow(): string {
	if (APP_CASHU_PUBLIC_KEY) return APP_CASHU_PUBLIC_KEY
	if (!APP_PRIVATE_KEY) throw new Error('Missing APP_PRIVATE_KEY')

	const privateKeyBytes = new Uint8Array(Buffer.from(APP_PRIVATE_KEY, 'hex'))
	APP_CASHU_PUBLIC_KEY = bytesToHex(secp256k1.getPublicKey(privateKeyBytes, true))
	return APP_CASHU_PUBLIC_KEY
}

function getCvmServerPublicKey(): string {
	if (CVM_SERVER_PUBKEY) return CVM_SERVER_PUBKEY
	if (process.env.CVM_SERVER_PUBKEY) {
		CVM_SERVER_PUBKEY = process.env.CVM_SERVER_PUBKEY
		return CVM_SERVER_PUBKEY
	}
	const serverPrivateKey = process.env.CVM_SERVER_KEY
	if (serverPrivateKey && /^[0-9a-fA-F]{64}$/.test(serverPrivateKey)) {
		CVM_SERVER_PUBKEY = getPublicKey(new Uint8Array(Buffer.from(serverPrivateKey, 'hex')))
		return CVM_SERVER_PUBKEY
	}

	CVM_SERVER_PUBKEY = '29bd6461f780c07b29c89b4df8017db90973d5608a3cd811a0522b15c1064f15'
	return CVM_SERVER_PUBKEY
}

function decodeLnurlBech32(lnurl: string): string | null {
	try {
		const decoded = bech32.decode(lnurl.toLowerCase(), 1500)
		const bytes = bech32.fromWords(decoded.words)
		return new TextDecoder().decode(Uint8Array.from(bytes))
	} catch {
		return null
	}
}

function toLnurlpEndpoint(lightningIdentifier: string): string {
	const trimmed = lightningIdentifier.trim()

	// LUD16: name@domain
	if (trimmed.includes('@')) {
		const [name, domain] = trimmed.split('@')
		if (!name || !domain) throw new Error('Invalid Lightning Address format')
		return `https://${domain}/.well-known/lnurlp/${name}`
	}

	// LUD06: bech32 lnurl
	if (trimmed.toLowerCase().startsWith('lnurl')) {
		const decoded = decodeLnurlBech32(trimmed)
		if (!decoded) throw new Error('Invalid LNURL (lud06)')
		return decoded
	}

	// Some profiles put the LNURL-pay endpoint directly in lud06
	if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
		return trimmed
	}

	throw new Error('Unsupported Lightning identifier (expected lud16 or lud06)')
}

async function ensureInvoiceNdkConnected(): Promise<NDK> {
	if (!RELAY_URL) {
		throw new Error('Missing APP_RELAY_URL')
	}
	if (!invoiceNdk) {
		invoiceNdk = new NDK({ explicitRelayUrls: [RELAY_URL] })
	}
	if (!invoiceNdkConnectPromise) {
		invoiceNdkConnectPromise = invoiceNdk.connect().catch((error) => {
			invoiceNdkConnectPromise = null
			throw error
		})
	}
	await invoiceNdkConnectPromise
	return invoiceNdk
}

async function getAppAuctionSigner(): Promise<NDKPrivateKeySigner> {
	if (appAuctionSigner) return appAuctionSigner
	if (!APP_PRIVATE_KEY) throw new Error('Missing APP_PRIVATE_KEY')
	appAuctionSigner = new NDKPrivateKeySigner(APP_PRIVATE_KEY)
	await appAuctionSigner.blockUntilReady()
	return appAuctionSigner
}

async function getMintKeysets(mintUrl: string): Promise<MintKeyset[]> {
	const normalizedMintUrl = normalizeMintUrl(mintUrl)
	const cached = mintKeysetCache.get(normalizedMintUrl)
	if (cached) return cached

	const cashuMint = new CashuMint(normalizedMintUrl)
	const keysetResponse = await cashuMint.getKeySets()
	const satKeysets = keysetResponse.keysets.filter((keyset) => keyset.unit === 'sat')
	const keysets = satKeysets.length > 0 ? satKeysets : keysetResponse.keysets
	if (keysets.length === 0) {
		throw new Error(`Mint ${normalizedMintUrl} returned no keysets`)
	}

	mintKeysetCache.set(normalizedMintUrl, keysets)
	return keysets
}

async function signAuctionTokenWithAppKey(token: string): Promise<string> {
	const { signP2PKProofs } = await import('@cashu/cashu-ts/crypto/client/NUT11')
	const mintUrl = normalizeMintUrl(getTokenMetadata(token).mint)
	const keysets = await getMintKeysets(mintUrl)
	const decoded = getDecodedToken(token, keysets)
	console.log('[auction:settlement-plan] pre-sign token summary', {
		mintUrl,
		proofCount: decoded.proofs.length,
		proofs: decoded.proofs.map((proof, index) => ({
			index,
			amount: proof.amount,
			witnessCount:
				typeof proof.witness === 'string' ? (JSON.parse(proof.witness).signatures?.length ?? 0) : (proof.witness?.signatures?.length ?? 0),
			secret: inspectAuctionP2pkSecret(proof.secret),
		})),
	})
	decoded.proofs = signP2PKProofs(decoded.proofs, APP_PRIVATE_KEY!, true)
	console.log('[auction:settlement-plan] post-sign token summary', {
		mintUrl,
		proofCount: decoded.proofs.length,
		proofs: decoded.proofs.map((proof, index) => ({
			index,
			amount: proof.amount,
			witnessCount:
				typeof proof.witness === 'string' ? (JSON.parse(proof.witness).signatures?.length ?? 0) : (proof.witness?.signatures?.length ?? 0),
			secret: inspectAuctionP2pkSecret(proof.secret),
		})),
	})
	return getEncodedToken(decoded)
}

async function buildAuctionSettlementPlan(params: {
	auctionEventId: string
	auctionCoordinates?: string
	status: AuctionSettlementPublishStatus
}): Promise<AuctionSettlementPlanResponse> {
	const ndk = await ensureInvoiceNdkConnected()
	const appPubkey = getAppPublicKeyOrThrow()
	const appCashuPubkey = getAppCashuPublicKeyOrThrow()
	const appSigner = await getAppAuctionSigner()
	const closeAt = Math.floor(Date.now() / 1000)

	const auctionEvent = await ndk.fetchEvent({
		kinds: [30408 as NDKKind],
		ids: [params.auctionEventId],
	})
	if (!auctionEvent) {
		throw new Error('Auction not found')
	}

	const auctionEscrowPubkey = normalizeAuctionP2pkPubkey(getAuctionTagValue(auctionEvent, 'escrow_pubkey'))
	if (!auctionP2pkPubkeysMatch(auctionEscrowPubkey, appCashuPubkey)) {
		throw new Error('Auction is not configured for this app escrow service')
	}
	if (getAuctionTagValue(auctionEvent, 'settlement_policy') !== 'cashu_p2pk_2of2_v1') {
		throw new Error('Auction settlement policy is not cashu_p2pk_2of2_v1')
	}

	const endAt = getAuctionEndAt(auctionEvent)
	if (!endAt || closeAt < endAt) {
		throw new Error('Auction has not ended yet')
	}

	const existingSettlements = await ndk.fetchEvents({
		kinds: [AUCTION_SETTLEMENT_KIND],
		'#e': [params.auctionEventId],
		limit: 20,
	})
	if (existingSettlements.size > 0) {
		throw new Error('Settlement already published for this auction')
	}

	const auctionCoordinates =
		params.auctionCoordinates ||
		(() => {
			const dTag = getAuctionTagValue(auctionEvent, 'd')
			return dTag ? `30408:${auctionEvent.pubkey}:${dTag}` : undefined
		})()

	const bidFilters = [
		{
			kinds: [AUCTION_BID_KIND],
			'#e': [params.auctionEventId],
			limit: 500,
		},
		...(auctionCoordinates
			? [
					{
						kinds: [AUCTION_BID_KIND],
						'#a': [auctionCoordinates],
						limit: 500,
					},
				]
			: []),
	]
	const bidEvents = Array.from(await ndk.fetchEvents(bidFilters.length === 1 ? bidFilters[0] : bidFilters))

	const envelopeFilters = [
		{
			kinds: [14],
			'#p': [appPubkey],
			'#t': [AUCTION_BID_TOKEN_TOPIC],
			'#e': [params.auctionEventId],
			limit: 500,
		},
		...(auctionCoordinates
			? [
					{
						kinds: [14],
						'#p': [appPubkey],
						'#t': [AUCTION_BID_TOKEN_TOPIC],
						'#a': [auctionCoordinates],
						limit: 500,
					},
				]
			: []),
	]
	const envelopeEvents = Array.from(await ndk.fetchEvents(envelopeFilters.length === 1 ? envelopeFilters[0] : envelopeFilters))
	const envelopeByBidId = new Map<string, ReturnType<typeof parseAuctionBidTokenEnvelope>>()

	for (const event of envelopeEvents) {
		try {
			const decryptable = new NDKEvent(ndk, event.rawEvent())
			await decryptable.decrypt(new NDKUser({ pubkey: event.pubkey }), appSigner, 'nip44')
			const envelope = parseAuctionBidTokenEnvelope(decryptable.content)
			if (!envelope || envelope.auctionEventId !== params.auctionEventId) continue
			if (!auctionP2pkPubkeysMatch(envelope.escrowPubkey, appCashuPubkey)) continue
			console.log('[auction:settlement-plan] decrypted envelope', {
				bidEventId: envelope.bidEventId,
				bidderPubkey: envelope.bidderPubkey,
				lockPubkey: inspectAuctionP2pkPubkey(envelope.lockPubkey),
				escrowPubkey: inspectAuctionP2pkPubkey(envelope.escrowPubkey),
				refundPubkey: inspectAuctionP2pkPubkey(envelope.refundPubkey),
				locktime: envelope.locktime,
			})
			const tokenCommitment = await sha256Hex(envelope.token)
			if (tokenCommitment !== envelope.commitment) continue
			envelopeByBidId.set(envelope.bidEventId, envelope)
		} catch (error) {
			console.error('[auction] Failed to decrypt app bid envelope:', error)
		}
	}

	const eligibleChains = buildActiveAuctionBidChains(bidEvents)
		.filter((group) =>
			group.chain.every((bid) => {
				const envelope = envelopeByBidId.get(bid.id)
				if (!envelope) return false
				return getAuctionTagValue(bid, 'commitment') === envelope.commitment
			}),
		)
		.sort(compareAuctionBidChainPriority)

	const reserve = getAuctionReserveAmount(auctionEvent)
	const winnerChain = eligibleChains[0]
	const winnerAmount = winnerChain ? getAuctionBidAmount(winnerChain.latestBid) : 0
	const resolvedStatus: AuctionSettlementPublishStatus = winnerChain && winnerAmount >= reserve ? 'settled' : 'reserve_not_met'

	if (resolvedStatus !== params.status) {
		if (params.status === 'settled') {
			throw new Error('No valid reserve-meeting winner is available for settlement')
		}
		throw new Error('A valid reserve-meeting winner exists; reserve_not_met is not allowed')
	}

	if (!winnerChain || resolvedStatus !== 'settled') {
		return {
			auctionEventId: params.auctionEventId,
			auctionCoordinates,
			status: 'reserve_not_met',
			closeAt,
			reserve,
			finalAmount: 0,
			winnerTokens: [],
		}
	}

	const winnerTokens: AuctionSettlementPlanResponse['winnerTokens'] = []
	for (const bid of winnerChain.chain) {
		const envelope = envelopeByBidId.get(bid.id)
		if (!envelope) {
			throw new Error(`Missing private token envelope for winning bid ${bid.id}`)
		}
		const derivationPath = getAuctionTagValue(bid, 'derivation_path')
		const childPubkey = getAuctionTagValue(bid, 'child_pubkey')
		if (!derivationPath || !childPubkey) {
			throw new Error(`Winning bid ${bid.id} is missing derivation metadata`)
		}
		winnerTokens.push({
			bidEventId: bid.id,
			bidderPubkey: envelope.bidderPubkey,
			derivationPath,
			childPubkey: normalizeAuctionP2pkPubkey(childPubkey),
			mintUrl: envelope.mintUrl,
			amount: envelope.amount,
			totalBidAmount: envelope.totalBidAmount,
			commitment: envelope.commitment,
			locktime: envelope.locktime,
			refundPubkey: envelope.refundPubkey,
			token: await signAuctionTokenWithAppKey(envelope.token),
		})
	}

	return {
		auctionEventId: params.auctionEventId,
		auctionCoordinates,
		status: 'settled',
		closeAt,
		reserve,
		winningBidEventId: winnerChain.latestBid.id,
		winnerPubkey: winnerChain.bidderPubkey,
		finalAmount: winnerAmount,
		winnerTokens,
	}
}

async function getAppLightningIdentifier(): Promise<string> {
	const envValue =
		process.env.APP_LIGHTNING_ADDRESS || process.env.APP_LUD16 || process.env.APP_LN_ADDRESS || process.env.APP_LIGHTNING_IDENTIFIER
	if (envValue && envValue.trim()) return envValue.trim()

	if (!APP_PUBLIC_KEY) {
		throw new Error('App public key not initialized')
	}

	const now = Date.now()
	if (cachedAppLightningIdentifier && now - cachedAppLightningIdentifier.fetchedAtMs < 5 * 60 * 1000) {
		return cachedAppLightningIdentifier.value
	}

	const ndk = await ensureInvoiceNdkConnected()
	const user = ndk.getUser({ pubkey: getAppPublicKeyOrThrow() })
	await user.fetchProfile()

	const identifier = user.profile?.lud16 || user.profile?.lud06
	if (!identifier) {
		throw new Error('App does not have a Lightning Address configured (missing lud16/lud06 on app profile)')
	}

	cachedAppLightningIdentifier = { value: identifier, fetchedAtMs: now }
	return identifier
}

async function initializeAppSettings() {
	if (!RELAY_URL || !APP_PRIVATE_KEY) {
		console.error('Missing required environment variables: APP_RELAY_URL, APP_PRIVATE_KEY')
		process.exit(1)
	}

	try {
		const privateKeyBytes = new Uint8Array(Buffer.from(APP_PRIVATE_KEY, 'hex'))
		APP_PUBLIC_KEY = getPublicKey(privateKeyBytes)
		appSettings = await fetchAppSettings(RELAY_URL as string, APP_PUBLIC_KEY)
		if (appSettings) {
			console.log('App settings loaded successfully')
		} else {
			console.log('No app settings found - setup required')
		}
	} catch (error) {
		console.error('Failed to initialize app settings:', error)
		process.exit(1)
	}
}
;(async () => await initializeAppSettings())()

export type NostrMessage = ['EVENT', Event]

// Track initialization state - mark as ready as soon as core components are initialized
// The heavy relay connections can fail/timeout without blocking setup
let eventHandlerReady = false

// Start initialization but don't block setup on relay connections
// Core components (signer, validator, admin manager) are set up synchronously in the constructor
// Only relay-dependent features (zaps, blacklist sync) may be delayed
const initPromise = getEventHandler()
	.initialize({
		appPrivateKey: process.env.APP_PRIVATE_KEY || '',
		adminPubkeys: [],
		relayUrl: RELAY_URL,
	})
	.then(() => {
		eventHandlerReady = true
		console.log('✅ EventHandler initialized successfully')
	})
	.catch((error) => {
		console.error('EventHandler initialization failed:', error)
		// Still mark as ready - core components are initialized, relay features may be degraded
		eventHandlerReady = true
	})

// For setup form: mark ready after short delay since core components are ready immediately
// This allows setup events to be processed even if relay connections are slow
setTimeout(() => {
	if (!eventHandlerReady) {
		console.log('Marking event handler ready after initial delay (core components ready)')
		eventHandlerReady = true
	}
}, 2000)

// Handle static files from the public directory
const serveStatic = async (path: string) => {
	const filePath = join(process.cwd(), 'public', path)
	try {
		const f = file(filePath)
		if (!f.exists()) {
			return new Response('File not found', { status: 404 })
		}
		// Determine content type based on file extension
		const contentType = path.endsWith('.svg')
			? 'image/svg+xml'
			: path.endsWith('.png')
				? 'image/png'
				: path.endsWith('.jpg') || path.endsWith('.jpeg')
					? 'image/jpeg'
					: path.endsWith('.css')
						? 'text/css'
						: path.endsWith('.js')
							? 'application/javascript'
							: path.endsWith('.json')
								? 'application/json'
								: path.endsWith('.ico')
									? 'image/x-icon'
									: 'application/octet-stream'

		return new Response(f, {
			headers: { 'Content-Type': contentType },
		})
	} catch (error) {
		console.error(`Error serving static file ${path}:`, error)
		return new Response('Internal server error', { status: 500 })
	}
}

/**
 * Determine the deployment stage from NODE_ENV
 */
function determineStage(): 'production' | 'staging' | 'development' {
	const explicitStage = process.env.APP_STAGE
	if (explicitStage === 'staging' || explicitStage === 'production' || explicitStage === 'development') {
		return explicitStage
	}

	const env = process.env.NODE_ENV
	if (env === 'staging') return 'staging'
	if (env === 'production') return 'production'
	return 'development'
}

const PORT = Number(process.env.PORT || 3000)

console.log(`App port: ${PORT}`)

export const server = serve({
	port: PORT,
	routes: {
		'/api/config': {
			GET: () => {
				const stage = determineStage()
				// Return cached settings loaded at startup
				return Response.json({
					appRelay: RELAY_URL,
					stage,
					nip46Relay: NIP46_RELAY_URL,
					appSettings: appSettings,
					appPublicKey: APP_PUBLIC_KEY,
					appCashuPublicKey: getAppCashuPublicKeyOrThrow(),
					cvmServerPubkey: getCvmServerPublicKey(),
					needsSetup: !appSettings,
					serverReady: eventHandlerReady,
				})
			},
		},
		//Generic zap purchase invoice endpoint.
		//Auto-resolves the correct `ZapPurchaseManager` from the zap request's `L` tag.
		'/api/zapPurchase': {
			POST: async (req) => {
				console.log('📨 /api/zapPurchase request received')

				let body: ZapPurchaseInvoiceRequestBody
				try {
					body = (await req.json()) as ZapPurchaseInvoiceRequestBody
				} catch {
					return jsonError('Invalid JSON body', 400)
				}

				// Auto-resolve the correct manager from the zap request's L (label) tag
				const { amountSats, registryKey, zapRequest } = body
				const zapLabel = zapRequest?.tags?.find((t) => t[0] === 'L')?.[1]
				if (!zapLabel) {
					return jsonError('zapRequest missing L tag', 400)
				}

				const manager = getEventHandler().getPurchaseManager(zapLabel)
				if (!manager) {
					return jsonError(`Unknown purchase type: ${zapLabel}`, 400)
				}

				try {
					const appPubkey = getAppPublicKeyOrThrow()
					const lightningIdentifier = await getAppLightningIdentifier()

					console.log(`⚡ Creating ${zapLabel} invoice:`, { registryKey, amountSats })

					const result = await manager.generateInvoice(
						{ amountSats, registryKey, zapRequest },
						appPubkey,
						lightningIdentifier,
						toLnurlpEndpoint,
					)

					console.log(`✅ ${zapLabel} invoice created`)
					return Response.json(result)
				} catch (error) {
					console.error(`${zapLabel} invoice error:`, error)
					if (error instanceof ZapInvoiceError) {
						return jsonError(error.message, error.status)
					}
					return jsonError(error instanceof Error ? error.message : 'Failed to create invoice', 500)
				}
			},
		},
		'/api/auctions/settlement-plan': {
			POST: async (req) => {
				let body: { auctionEventId?: string; auctionCoordinates?: string; status?: AuctionSettlementPublishStatus }
				try {
					body = (await req.json()) as { auctionEventId?: string; auctionCoordinates?: string; status?: AuctionSettlementPublishStatus }
				} catch {
					return jsonError('Invalid JSON body', 400)
				}

				if (!body.auctionEventId || (body.status !== 'settled' && body.status !== 'reserve_not_met')) {
					return jsonError('auctionEventId and a valid settlement status are required', 400)
				}

				try {
					const plan = await buildAuctionSettlementPlan({
						auctionEventId: body.auctionEventId,
						auctionCoordinates: body.auctionCoordinates,
						status: body.status,
					})
					return Response.json(plan)
				} catch (error) {
					console.error('Auction settlement planning failed:', error)
					return jsonError(error instanceof Error ? error.message : 'Failed to build auction settlement plan', 400)
				}
			},
		},
		'/images/:file': ({ params }) => serveStatic(`images/${params.file}`),
		'/.well-known/nostr.json': {
			GET: (req) => {
				const url = new URL(req.url)
				const name = url.searchParams.get('name') ?? undefined
				const nip05Manager = getEventHandler().getNip05Manager()
				const result = nip05Manager.buildNostrJson(name)
				return Response.json(result, {
					headers: {
						'Access-Control-Allow-Origin': '*',
						'Cache-Control': 'max-age=300',
					},
				})
			},
		},
		'/manifest.json': () => serveStatic('manifest.json'),
		'/sw.js': () => serveStatic('sw.js'),
		'/favicon.ico': () => serveStatic('favicon.ico'),
		'/*': index,
	},
	development: process.env.NODE_ENV !== 'production',
	fetch(req, server) {
		if (server.upgrade(req)) {
			return new Response()
		}
		return new Response('Upgrade failed', { status: 500 })
	},
	// @ts-ignore
	websocket: {
		async message(ws, message) {
			try {
				const messageStr = String(message)
				const data = JSON.parse(messageStr)

				if (Array.isArray(data) && data[0] === 'EVENT' && data[1].sig) {
					console.log('Processing EVENT message')

					// Check if EventHandler is ready
					if (!eventHandlerReady) {
						const errorResponse = ['OK', data[1].id, false, 'error: Server initializing, please try again']
						ws.send(JSON.stringify(errorResponse))
						return
					}

					if (!verifyEvent(data[1] as Event)) {
						ws.send(JSON.stringify(['OK', data[1].id, false, 'error: Unable to verify event signature']))
						return
					}

					let resignedEvent
					try {
						resignedEvent = getEventHandler().handleEvent(data[1])
					} catch (handleError) {
						console.error('Error in handleEvent:', handleError)
						ws.send(JSON.stringify(['OK', data[1].id, false, `error: Handler error: ${handleError}`]))
						return
					}

					if (resignedEvent) {
						const relay = await Relay.connect(RELAY_URL as string)
						await relay.publish(resignedEvent as Event)

						// Update cached appSettings when a kind 31990 event is published
						if (resignedEvent.kind === 31990) {
							try {
								const parsed = AppSettingsSchema.parse(JSON.parse(resignedEvent.content))
								appSettings = parsed
								console.log('App settings cache updated from new kind 31990 event')
							} catch (e) {
								console.warn('Failed to update app settings cache:', e)
							}
						}

						const okResponse = ['OK', resignedEvent.id, true, '']
						ws.send(JSON.stringify(okResponse))
					} else {
						// If event was not from admin
						const okResponse = ['OK', data[1].id, false, 'Not authorized']
						ws.send(JSON.stringify(okResponse))
					}
				}
			} catch (error) {
				console.error('Error processing WebSocket message:', error)
				try {
					const failedData = JSON.parse(String(message)) as Event
					if (failedData.id) {
						const errorResponse = ['OK', failedData.id, false, `error: Invalid message format ${error}`]
						ws.send(JSON.stringify(errorResponse))
						return
					}
				} catch {
					ws.send(JSON.stringify(['NOTICE', 'error: Invalid JSON']))
				}
			}
		},
	},
})

console.log(`🚀 Server running at ${server.url}`)
