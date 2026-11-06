/** Durable authority, signer, terminal-fence and seller-recovery boundaries for auction payout catalogs. */
import { Database } from 'bun:sqlite'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	prepareDemoFridayAuctionPayoutAuthorization,
	selectDemoFridayAuctionPayout,
	verifyDemoFridayAuctionPayoutAuthorization,
	verifyDemoFridayAuctionPayoutSelectionStatic,
	type DemoFridayAuctionPayoutAuthorizationEnvelopeV1,
	type DemoFridayAuctionPayoutLiveAuctionV1,
	type DemoFridayAuctionPayoutScopeV1,
	type DemoFridayAuctionPayoutSelectionV1,
} from './demo-friday-auction-payout-authorization'
import type {
	DemoFridaySellerNostrPort,
	DemoFridaySellerOpeningRefV1,
	DemoFridaySellerRecipientKeyPort,
} from './demo-friday-browser-coco-seller-plan'
import type { DemoRecipientKeyset, DemoRecipientPrivateJournalPort } from './demo-sigall-recipient'

const HEX_32 = /^[0-9a-f]{64}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/

function refuse(message: string): never { throw new Error(`DEMO_FRIDAY_AUCTION_PAYOUT_RUNTIME: ${message}`) }

function canonical(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value)) refuse('canonical value contains a non-safe integer')
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
	if (typeof value !== 'object') refuse('canonical value contains an unsupported value')
	const record = value as Record<string, unknown>
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

function digest(value: unknown): string { return bytesToHex(sha256(utf8ToBytes(canonical(value)))) }

export interface DemoFridayAuctionPayoutWinnerOutcomeV1 {
	schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_WINNER_OUTCOME_V1'
	auctionId: string
	winnerFundingOperationId: string
	winnerActor: string
	winningAmount: number
	stateHeight: number
	appHash: string
	closedAt: number
}

export interface DemoFridayAuctionPayoutWinnerClaimV1 {
	schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_WINNER_CLAIM_V1'
	auctionId: string
	authorizationDigest: string
	fundingOperationId: string
	selectionDigest: string
	/** Public exact winning selection; seller openings remain browser-private. */
	selection: DemoFridayAuctionPayoutSelectionV1
	outcomeHeight: number
	closedAt: number
}

export interface DemoFridayAuctionPayoutAnchorSnapshotV1 {
	schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_ANCHOR_SNAPSHOT_V1'
	deploymentId: string
	storeGeneration: string
	globalRevision: number
	stateDigest: string
}

export interface DemoFridayAuctionPayoutAnchorPort {
	observeExact(snapshot: DemoFridayAuctionPayoutAnchorSnapshotV1): void
}

function exactEnvelope(value: string): DemoFridayAuctionPayoutAuthorizationEnvelopeV1 {
	let parsed: unknown
	try { parsed = JSON.parse(value) } catch { return refuse('stored authorization is not JSON') }
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) refuse('stored authorization is malformed')
	return parsed as DemoFridayAuctionPayoutAuthorizationEnvelopeV1
}

export class DemoFridayAuctionPayoutRollbackAnchorSqlite implements DemoFridayAuctionPayoutAnchorPort {
	constructor(private readonly database: Database, private readonly allowFirstEnrollment = false) {
		database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
			CREATE TABLE IF NOT EXISTS friday_auction_payout_rollback_anchor (
				id INTEGER PRIMARY KEY NOT NULL CHECK (id=1), deployment_id TEXT NOT NULL,
				store_generation TEXT NOT NULL, maximum_revision INTEGER NOT NULL, state_digest TEXT NOT NULL
			) STRICT`)
	}

	observeExact(snapshot: DemoFridayAuctionPayoutAnchorSnapshotV1): void {
		if (snapshot.schema !== 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_ANCHOR_SNAPSHOT_V1'
			|| !ID.test(snapshot.deploymentId) || !HEX_32.test(snapshot.storeGeneration)
			|| !Number.isSafeInteger(snapshot.globalRevision) || snapshot.globalRevision < 0
			|| !HEX_32.test(snapshot.stateDigest)) refuse('anchor snapshot is malformed')
		this.database.transaction(() => {
			const prior = this.database.query<{ deployment_id: string; store_generation: string;
				maximum_revision: number; state_digest: string }, []>(`SELECT deployment_id,store_generation,
				maximum_revision,state_digest FROM friday_auction_payout_rollback_anchor WHERE id=1`).get()
			if (prior === null) {
				if (!this.allowFirstEnrollment || snapshot.globalRevision !== 0) refuse('independent payout anchor is missing')
				this.database.query(`INSERT INTO friday_auction_payout_rollback_anchor
					(id,deployment_id,store_generation,maximum_revision,state_digest) VALUES(1,?,?,?,?)`)
					.run(snapshot.deploymentId, snapshot.storeGeneration, snapshot.globalRevision, snapshot.stateDigest)
				return
			}
			if (prior.deployment_id !== snapshot.deploymentId || prior.store_generation !== snapshot.storeGeneration) {
				refuse('payout registry deployment or generation was replaced')
			}
			if (snapshot.globalRevision < prior.maximum_revision) refuse('payout registry revision regressed')
			if (snapshot.globalRevision === prior.maximum_revision) {
				if (snapshot.stateDigest !== prior.state_digest) refuse('payout registry changed at an anchored revision')
				return
			}
			this.database.query(`UPDATE friday_auction_payout_rollback_anchor
				SET maximum_revision=?,state_digest=? WHERE id=1`)
				.run(snapshot.globalRevision, snapshot.stateDigest)
		}).immediate()
	}
}

export class DemoFridayAuctionPayoutRegistrySqlite {
	readonly storeGeneration: string

	constructor(
		private readonly database: Database,
		readonly deploymentId: string,
		private readonly anchor: DemoFridayAuctionPayoutAnchorPort,
	) {
		if (!ID.test(deploymentId)) refuse('deployment identity is invalid')
		database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
			CREATE TABLE IF NOT EXISTS friday_auction_payout_observation (
                auction_id TEXT PRIMARY KEY NOT NULL, state_height INTEGER NOT NULL,
                app_hash TEXT NOT NULL, state_digest TEXT NOT NULL
            ) STRICT;
            CREATE TABLE IF NOT EXISTS friday_auction_payout_metadata (
				id INTEGER PRIMARY KEY NOT NULL CHECK (id=1), deployment_id TEXT NOT NULL,
				store_generation TEXT NOT NULL, global_revision INTEGER NOT NULL
			) STRICT;
			CREATE TABLE IF NOT EXISTS friday_auction_payout_authorization (
				auction_id TEXT PRIMARY KEY NOT NULL, authorization_digest TEXT UNIQUE NOT NULL,
				record_json TEXT NOT NULL
			) STRICT;
			CREATE TABLE IF NOT EXISTS friday_auction_payout_winner_fence (
				authorization_digest TEXT PRIMARY KEY NOT NULL, auction_id TEXT UNIQUE NOT NULL,
				funding_operation_id TEXT NOT NULL, selection_digest TEXT NOT NULL,
				outcome_height INTEGER NOT NULL, record_json TEXT NOT NULL
			) STRICT`)
		database.transaction(() => {
			const prior = database.query<{ deployment_id: string; store_generation: string }, []>(
				'SELECT deployment_id,store_generation FROM friday_auction_payout_metadata WHERE id=1').get()
			if (prior === null) {
				const generation = bytesToHex(crypto.getRandomValues(new Uint8Array(32)))
				database.query(`INSERT INTO friday_auction_payout_metadata
					(id,deployment_id,store_generation,global_revision) VALUES(1,?,?,0)`).run(deploymentId, generation)
			} else if (prior.deployment_id !== deploymentId || !HEX_32.test(prior.store_generation)) {
				refuse('payout registry belongs to another deployment or generation')
			}
		}).immediate()
		this.storeGeneration = database.query<{ store_generation: string }, []>(
			'SELECT store_generation FROM friday_auction_payout_metadata WHERE id=1').get()!.store_generation
		anchor.observeExact(this.anchorSnapshot())
	}

	private advance(): void {
		if (this.database.query(`UPDATE friday_auction_payout_metadata
			SET global_revision=global_revision+1 WHERE id=1`).run().changes !== 1) refuse('payout registry metadata did not advance')
	}

	private observe(): void { this.anchor.observeExact(this.anchorSnapshot()) }

	anchorSnapshot(): DemoFridayAuctionPayoutAnchorSnapshotV1 {
		const meta = this.database.query<{ global_revision: number }, []>(
			'SELECT global_revision FROM friday_auction_payout_metadata WHERE id=1').get()!
		const authorizations = this.database.query<{ auction_id: string; authorization_digest: string; record_json: string }, []>(
			'SELECT auction_id,authorization_digest,record_json FROM friday_auction_payout_authorization ORDER BY auction_id').all()
		const winners = this.database.query<{ authorization_digest: string; auction_id: string; funding_operation_id: string;
			selection_digest: string; outcome_height: number; record_json: string }, []>(`SELECT authorization_digest,auction_id,
			funding_operation_id,selection_digest,outcome_height,record_json
			FROM friday_auction_payout_winner_fence ORDER BY authorization_digest`).all()
		const observations = this.database.query<{ auction_id: string; state_height: number; app_hash: string; state_digest: string }, []>(
            'SELECT auction_id,state_height,app_hash,state_digest FROM friday_auction_payout_observation ORDER BY auction_id').all()
        return {
            schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_ANCHOR_SNAPSHOT_V1',
			deploymentId: this.deploymentId,
			storeGeneration: this.storeGeneration,
			globalRevision: meta.global_revision,
			stateDigest: digest(['PLEBEIAN_FRIDAY_AUCTION_PAYOUT_STATE_V1', this.deploymentId,
				this.storeGeneration, meta.global_revision, authorizations, winners, ...(observations.length ? [observations] : [])]),
		}
	}

    /** Persistent monotonic floor, including same-height equivocation detection. This
     * does not replace the authenticated reader's trusted fresh-head requirement. */
    observeAuctionExact(auction: DemoFridayAuctionPayoutLiveAuctionV1): void {
        if (!ID.test(auction.auctionId) || !Number.isSafeInteger(auction.stateHeight)
            || auction.stateHeight < 1 || !HEX_32.test(auction.appHash)) refuse('auction observation is malformed')
        this.database.transaction(() => {
            this.observe()
            const prior = this.database.query<{ state_height: number; app_hash: string; state_digest: string }, [string]>(
                'SELECT state_height,app_hash,state_digest FROM friday_auction_payout_observation WHERE auction_id=?').get(auction.auctionId)
            const stateDigest = digest(auction)
            if (prior !== null) {
                if (auction.stateHeight < prior.state_height) refuse('auction observation regressed')
                if (auction.stateHeight === prior.state_height) {
                    if (auction.appHash !== prior.app_hash || stateDigest !== prior.state_digest) refuse('auction observation conflicts at the same height')
                    return
                }
            }
            this.database.query(`INSERT INTO friday_auction_payout_observation
                (auction_id,state_height,app_hash,state_digest) VALUES(?,?,?,?)
                ON CONFLICT(auction_id) DO UPDATE SET state_height=excluded.state_height,
                app_hash=excluded.app_hash,state_digest=excluded.state_digest`)
                .run(auction.auctionId, auction.stateHeight, auction.appHash, stateDigest)
            this.advance()
        }).immediate()
        this.observe()
    }

	readAuthorizationExact(auctionId: string): DemoFridayAuctionPayoutAuthorizationEnvelopeV1 | null {
		if (!ID.test(auctionId)) refuse('auction identity is invalid')
		const row = this.database.query<{ record_json: string }, [string]>(
			'SELECT record_json FROM friday_auction_payout_authorization WHERE auction_id=?').get(auctionId)
		return row === null ? null : structuredClone(exactEnvelope(row.record_json))
	}

	registerAuthorizationExact(value: DemoFridayAuctionPayoutAuthorizationEnvelopeV1): DemoFridayAuctionPayoutAuthorizationEnvelopeV1 {
		const auctionId = value.authorization.auctionId, authorizationDigest = value.authorizationDigest
		if (!ID.test(auctionId) || !HEX_32.test(authorizationDigest)) refuse('authorization registry identity is invalid')
		const result = this.database.transaction(() => {
			const prior = this.database.query<{ authorization_digest: string; record_json: string }, [string]>(
				'SELECT authorization_digest,record_json FROM friday_auction_payout_authorization WHERE auction_id=?').get(auctionId)
			if (prior !== null) {
				const held = exactEnvelope(prior.record_json)
				// A Schnorr signer may produce another valid signature for the same
				// event. Idempotency belongs to the authorization body/digest, not the
				// signature bytes returned after a lost response.
				if (prior.authorization_digest !== authorizationDigest
					|| canonical(held.authorization) !== canonical(value.authorization)) {
					refuse('auction already owns another payout authorization')
				}
				return held
			}
			this.database.query(`INSERT INTO friday_auction_payout_authorization
				(auction_id,authorization_digest,record_json) VALUES(?,?,?)`)
				.run(auctionId, authorizationDigest, canonical(value))
			this.advance()
			return value
		}).immediate()
		this.observe()
		return structuredClone(result)
	}

	readWinnerExact(authorizationDigest: string): DemoFridayAuctionPayoutWinnerClaimV1 | null {
		if (!HEX_32.test(authorizationDigest)) refuse('winner authorization identity is invalid')
		const row = this.database.query<{ record_json: string }, [string]>(
			'SELECT record_json FROM friday_auction_payout_winner_fence WHERE authorization_digest=?').get(authorizationDigest)
		if (row === null) return null
		let parsed: unknown
		try { parsed = JSON.parse(row.record_json) } catch { return refuse('stored winner claim is not JSON') }
		return structuredClone(parsed) as DemoFridayAuctionPayoutWinnerClaimV1
	}

	readWinnerByAuctionExact(auctionId: string): DemoFridayAuctionPayoutWinnerClaimV1 | null {
		if (!ID.test(auctionId)) refuse('winner auction identity is invalid')
		const row = this.database.query<{ record_json: string }, [string]>(
			'SELECT record_json FROM friday_auction_payout_winner_fence WHERE auction_id=?').get(auctionId)
		if (row === null) return null
		let parsed: unknown
		try { parsed = JSON.parse(row.record_json) } catch { return refuse('stored winner claim is not JSON') }
		return structuredClone(parsed) as DemoFridayAuctionPayoutWinnerClaimV1
	}

	claimWinnerExact(value: DemoFridayAuctionPayoutWinnerClaimV1): DemoFridayAuctionPayoutWinnerClaimV1 {
		if (value.schema !== 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_WINNER_CLAIM_V1'
			|| !ID.test(value.auctionId) || !HEX_32.test(value.authorizationDigest)
			|| !ID.test(value.fundingOperationId) || !HEX_32.test(value.selectionDigest)
			|| value.selection?.selectionDigest !== value.selectionDigest
			|| value.selection.authorizationDigest !== value.authorizationDigest
			|| value.selection.auctionId !== value.auctionId
			|| value.selection.fundingOperationId !== value.fundingOperationId
			|| !Number.isSafeInteger(value.outcomeHeight) || value.outcomeHeight < 1
			|| !Number.isSafeInteger(value.closedAt) || value.closedAt < 1) refuse('winner claim is malformed')
		const result = this.database.transaction(() => {
			const prior = this.database.query<{ record_json: string }, [string]>(
				'SELECT record_json FROM friday_auction_payout_winner_fence WHERE authorization_digest=?').get(value.authorizationDigest)
			if (prior !== null) {
				let held: unknown
				try { held = JSON.parse(prior.record_json) } catch { return refuse('stored winner claim is not JSON') }
				if (canonical(held) !== canonical(value)) refuse('auction authorization already paid another winner')
				return held as DemoFridayAuctionPayoutWinnerClaimV1
			}
			this.database.query(`INSERT INTO friday_auction_payout_winner_fence
				(authorization_digest,auction_id,funding_operation_id,selection_digest,outcome_height,record_json)
				VALUES(?,?,?,?,?,?)`).run(value.authorizationDigest, value.auctionId, value.fundingOperationId,
				value.selectionDigest, value.outcomeHeight, canonical(value))
			this.advance()
			return value
		}).immediate()
		this.observe()
		return structuredClone(result)
	}
}

export interface DemoFridayAuctionPayoutAuthorityPort {
	registerExact(value: DemoFridayAuctionPayoutAuthorizationEnvelopeV1): Promise<DemoFridayAuctionPayoutAuthorizationEnvelopeV1>
	readExact(auctionId: string): Promise<DemoFridayAuctionPayoutAuthorizationEnvelopeV1 | null>
	readWinnerExact(auctionId: string): Promise<DemoFridayAuctionPayoutWinnerClaimV1 | null>
	selectExact(request: {
		auctionId: string
		fundingOperationId: string
		bidderActor: string
		bidAmount: number
		replacesBidId: string
	}): Promise<DemoFridayAuctionPayoutSelectionV1 | null>
	assertRegisteredSelectionExact(request: {
		auctionId: string
		fundingOperationId: string
		bidderActor: string
		bidAmount: number
		winnerRequest: { capability: unknown; outputs: unknown }
		authorization: DemoFridayAuctionPayoutAuthorizationEnvelopeV1
		selection: DemoFridayAuctionPayoutSelectionV1
		keyset: DemoRecipientKeyset
	}): Promise<void>
	claimWinnerExact(request: {
		selection: DemoFridayAuctionPayoutSelectionV1
		outcome: DemoFridayAuctionPayoutWinnerOutcomeV1
	}): Promise<DemoFridayAuctionPayoutWinnerClaimV1>
}

function assertAuctionScope(
	value: DemoFridayAuctionPayoutAuthorizationEnvelopeV1,
	auction: DemoFridayAuctionPayoutLiveAuctionV1,
): void {
	const authorization = value.authorization
	if (auction.auctionId !== authorization.auctionId || auction.status !== 'open'
		|| auction.sellerActor !== authorization.sellerActor
		|| auction.sellerPaymentPublicKey !== authorization.sellerPaymentPublicKey
		|| auction.startingBid !== authorization.startingBid || auction.minIncrement !== authorization.minIncrement
		|| auction.reserve !== authorization.reserve || auction.originalEndTime !== authorization.originalEndTime
		|| auction.endTime < authorization.originalEndTime || auction.endTime > authorization.maximumEndTime) {
		refuse('authenticated auction differs from the seller payout authorization')
	}
}

/** Terminal-only winner fence; it needs no mutable open-auction reader. */
export function claimDemoFridayAuctionPayoutWinnerExact(options: {
	registry: DemoFridayAuctionPayoutRegistrySqlite
	keyset: DemoRecipientKeyset
	selection: DemoFridayAuctionPayoutSelectionV1
	outcome: DemoFridayAuctionPayoutWinnerOutcomeV1
}): DemoFridayAuctionPayoutWinnerClaimV1 {
	const { outcome } = options
	if (outcome.schema !== 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_WINNER_OUTCOME_V1'
		|| !ID.test(outcome.auctionId) || !ID.test(outcome.winnerFundingOperationId)
		|| !HEX_32.test(outcome.winnerActor) || !Number.isSafeInteger(outcome.winningAmount)
		|| outcome.winningAmount < 1 || !Number.isSafeInteger(outcome.stateHeight) || outcome.stateHeight < 1
		|| !HEX_32.test(outcome.appHash) || !Number.isSafeInteger(outcome.closedAt)) refuse('winner outcome is malformed')
	const authorization = options.registry.readAuthorizationExact(outcome.auctionId)
	if (authorization === null) refuse('winner outcome has no registered auction authorization')
	const verified = verifyDemoFridayAuctionPayoutSelectionStatic(options.selection, {
		authorization, keyset: options.keyset, observedAt: outcome.closedAt,
	})
	if (verified.auctionId !== outcome.auctionId
		|| verified.fundingOperationId !== outcome.winnerFundingOperationId
		|| verified.bidderActor !== outcome.winnerActor || verified.bidAmount !== outcome.winningAmount
		|| outcome.stateHeight < verified.stateHeight || outcome.closedAt < authorization.authorization.originalEndTime
		|| outcome.closedAt > authorization.authorization.validUntil) {
		refuse('winner outcome differs from the exact authorized selection')
	}
	return options.registry.claimWinnerExact({
		schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_WINNER_CLAIM_V1',
		auctionId: outcome.auctionId,
		authorizationDigest: verified.authorizationDigest,
		fundingOperationId: verified.fundingOperationId,
		selectionDigest: verified.selectionDigest,
		selection: structuredClone(verified),
		outcomeHeight: outcome.stateHeight,
		closedAt: outcome.closedAt,
	})
}

export function createDemoFridayAuctionPayoutAuthority(options: {
	keyset: DemoRecipientKeyset
	registry: DemoFridayAuctionPayoutRegistrySqlite
	auctions: { readExact(auctionId: string): Promise<DemoFridayAuctionPayoutLiveAuctionV1> }
	nowSeconds?: () => number
}): DemoFridayAuctionPayoutAuthorityPort {
	const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1_000))
	const service: DemoFridayAuctionPayoutAuthorityPort = {
		async registerExact(value) {
			const verified = verifyDemoFridayAuctionPayoutAuthorization(value, options.keyset, nowSeconds())
			const auction = await options.auctions.readExact(verified.authorization.auctionId)
            assertAuctionScope(verified, auction)
            options.registry.observeAuctionExact(auction)
			return options.registry.registerAuthorizationExact(verified)
		},
		async readExact(auctionId) { return options.registry.readAuthorizationExact(auctionId) },
		async readWinnerExact(auctionId) { return options.registry.readWinnerByAuctionExact(auctionId) },
		async selectExact(request) {
			const authorization = options.registry.readAuthorizationExact(request.auctionId)
			if (authorization === null) return null
			const auction = await options.auctions.readExact(request.auctionId)
			assertAuctionScope(authorization, auction)
			options.registry.observeAuctionExact(auction)
			return selectDemoFridayAuctionPayout({ authorization, keyset: options.keyset,
				nowSeconds: nowSeconds(), auction, request })
		},
		async assertRegisteredSelectionExact(request) {
			const held = options.registry.readAuthorizationExact(request.auctionId)
			if (held === null || held.authorizationDigest !== request.authorization.authorizationDigest
				|| canonical(held.authorization) !== canonical(request.authorization.authorization)
				|| canonical(request.keyset) !== canonical(options.keyset)) {
				refuse('prepared funding did not use the registered auction authorization')
			}
			const selection = verifyDemoFridayAuctionPayoutSelectionStatic(request.selection, {
				authorization: held, keyset: options.keyset, observedAt: nowSeconds(),
			})
			if (selection.auctionId !== request.auctionId
				|| selection.fundingOperationId !== request.fundingOperationId
				|| selection.bidderActor !== request.bidderActor || selection.bidAmount !== request.bidAmount
				|| canonical(selection.outputs) !== canonical(request.winnerRequest.outputs)
				|| canonical(held.authorization.recipientCatalog.capability) !== canonical(request.winnerRequest.capability)) {
				refuse('prepared funding differs from the registered auction payout selection')
			}
		},
		async claimWinnerExact({ selection, outcome }) {
			return claimDemoFridayAuctionPayoutWinnerExact({
				registry: options.registry, keyset: options.keyset, selection, outcome,
			})
		},
	}
	return Object.freeze(service)
}

/** Each validator can apply this before signing a catalog-backed winner branch. */
export function assertDemoFridayAuctionPayoutSignerBinding(options: {
	authorization: DemoFridayAuctionPayoutAuthorizationEnvelopeV1
	selection: DemoFridayAuctionPayoutSelectionV1
	keyset: DemoRecipientKeyset
	observedAt: number
	template: {
		network: string
		chainId: string
		auctionId: string
		operationId: string
		bidderActorId: string
		amount: number
		recipientPublicKey: string
		activeSatKeysetId: string
		denominationKeyDigest: string
		outputs: Array<{ amount: number; id: string; B_: string }>
	}
}): void {
	const selection = verifyDemoFridayAuctionPayoutSelectionStatic(options.selection, {
		authorization: options.authorization, keyset: options.keyset, observedAt: options.observedAt,
	})
	const authorization = options.authorization.authorization, template = options.template
	if (template.network !== authorization.authNetworkId || template.chainId !== authorization.chainId
		|| template.auctionId !== selection.auctionId || template.operationId !== selection.fundingOperationId
		|| template.bidderActorId !== selection.bidderActor || template.amount !== selection.bidAmount
		|| template.recipientPublicKey !== authorization.sellerPaymentPublicKey
		|| template.activeSatKeysetId !== authorization.activeSatKeysetId
		|| template.denominationKeyDigest !== authorization.denominationKeyDigest
		|| canonical(template.outputs) !== canonical(selection.outputs)) {
		refuse('signer template differs from the registered auction payout selection')
	}
}

/**
 * Seller-private recovery boundary. Openings are supplied only to the callback
 * and are never placed in a public return value.
 */
export async function withDemoFridayAuctionPayoutOpenings<T>(options: {
	authorization: DemoFridayAuctionPayoutAuthorizationEnvelopeV1
	selection: DemoFridayAuctionPayoutSelectionV1
	keyset: DemoRecipientKeyset
	observedAt: number
	journal: DemoRecipientPrivateJournalPort<DemoFridaySellerOpeningRefV1>
	useExact: (value: Array<{
		index: number
		output: { amount: number; id: string; B_: string }
		opening: DemoFridaySellerOpeningRefV1
	}>) => Promise<T>
}): Promise<T> {
	const selection = verifyDemoFridayAuctionPayoutSelectionStatic(options.selection, {
		authorization: options.authorization, keyset: options.keyset, observedAt: options.observedAt,
	})
	const authorization = options.authorization.authorization
	const scope = `${authorization.authNetworkId}\u0000${authorization.chainId}\u0000${authorization.auctionId}\u0000${authorization.catalogOperationId}`
	return options.journal.runExclusive(scope, async () => {
		const record = await options.journal.load(scope)
		if (record === null || canonical(record.coordinatorRequest) !== canonical(authorization.recipientCatalog)
			|| record.privateOpeningRefs.length !== authorization.recipientCatalog.outputs.length) {
			refuse('seller-private catalog journal is absent or differs from the authorization')
		}
		const selected = selection.selectedIndexes.map((index, position) => {
			const output = authorization.recipientCatalog.outputs[index], opening = record.privateOpeningRefs[index]
			if (output === undefined || opening === undefined || opening.B_ !== output.B_
				|| canonical(output) !== canonical(selection.outputs[position])) {
				refuse('seller-private opening differs from the winning catalog selection')
			}
			return { index, output: structuredClone(output), opening: structuredClone(opening) }
		})
		return options.useExact(selected)
	})
}

/** UI-facing composition: one explicit authorization prompt at listing time. */
export function createDemoFridayAuctionPayoutBrowserController(options: {
	keyset: DemoRecipientKeyset
	journal: DemoRecipientPrivateJournalPort<DemoFridaySellerOpeningRefV1>
	recipientKey: DemoFridaySellerRecipientKeyPort
	nostr: DemoFridaySellerNostrPort
	authority: Pick<DemoFridayAuctionPayoutAuthorityPort, 'registerExact' | 'readExact'>
	nowSeconds?: () => number
}) {
	const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1_000))
	return Object.freeze({
		async authorizeAuctionExact(scope: Omit<DemoFridayAuctionPayoutScopeV1, 'validFrom'>, control: {
			assertActive?: () => Promise<void>
			signal?: AbortSignal
		} = {}) {
			await control.assertActive?.()
			const preparedAt = nowSeconds()
			const priorRaw = await options.authority.readExact(scope.auctionId)
			if (priorRaw !== null) {
				const prior = verifyDemoFridayAuctionPayoutAuthorization(priorRaw, options.keyset, preparedAt)
				const authorization = prior.authorization
				const expected = canonical(scope)
				const actual = canonical({
					schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_SCOPE_V1',
					authNetworkId: authorization.authNetworkId, chainId: authorization.chainId,
					auctionId: authorization.auctionId, sellerActor: authorization.sellerActor,
					sellerPaymentPublicKey: authorization.sellerPaymentPublicKey,
					canonicalMintUrl: authorization.canonicalMintUrl,
					activeSatKeysetId: authorization.activeSatKeysetId,
					denominationKeyDigest: authorization.denominationKeyDigest,
					startingBid: authorization.startingBid, minIncrement: authorization.minIncrement,
					reserve: authorization.reserve, originalEndTime: authorization.originalEndTime,
					maximumEndTime: authorization.maximumEndTime, maximumPayout: authorization.maximumPayout,
					validUntil: authorization.validUntil,
				})
				if (actual !== expected) refuse('registered auction payout differs from this listing request')
				const catalogScope = `${authorization.authNetworkId}\u0000${authorization.chainId}\u0000${authorization.auctionId}\u0000${authorization.catalogOperationId}`
				const local = await options.journal.load(catalogScope)
				if (local === null || canonical(local.coordinatorRequest) !== canonical(authorization.recipientCatalog)
					|| local.privateOpeningRefs.length !== authorization.recipientCatalog.outputs.length) {
					refuse('registered auction payout lacks this browser private catalog')
				}
				await control.assertActive?.()
				return structuredClone(prior)
			}
			const envelope = await prepareDemoFridayAuctionPayoutAuthorization({
				scope: { ...scope, validFrom: preparedAt }, keyset: options.keyset, journal: options.journal,
				recipientKey: options.recipientKey, nostr: options.nostr,
				nowSeconds: preparedAt, assertSigningScope: control.assertActive, signal: control.signal,
			})
			await control.assertActive?.()
			const registered = await options.authority.registerExact(envelope)
			if (registered.authorizationDigest !== envelope.authorizationDigest
				|| canonical(registered.authorization) !== canonical(envelope.authorization)) {
				refuse('authority registered another auction payout authorization')
			}
			return structuredClone(registered)
		},
		async readAuthorizationExact(auctionId: string) {
			const value = await options.authority.readExact(auctionId)
			return value === null ? null
				: verifyDemoFridayAuctionPayoutAuthorization(value, options.keyset, nowSeconds())
		},
	})
}
