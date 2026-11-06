import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import {
	DemoFridayCocoTerminalExchangeSqlite,
	demoFridayCocoTerminalAckDigest,
	demoFridayCocoTerminalNoticeDigest,
} from './demo-friday-coco-terminal-exchange'
import {
	createDemoFridayCoordinatorWorker,
	DemoFridayCoordinatorSqlite,
	type DemoFridayCoordinatorPorts,
	type DemoFridayTerminalBranch,
} from './demo-friday-coordinator-runtime'

const DEPLOYMENT = 'contributor-legacy-fixture'

/**
 * Synthetic stable identities covering seven historical recipient-pending
 * cases. No live operation identifiers or bearer material are published here.
 * Restart checks must preserve each identity rather than relabel an effect.
 */
const LEGACY = Object.freeze([
	{ operationId: 'cb32dbbdd1666059e028a0e80774cf3471b27a8148754c04a3d720dab8ae8261', branch: 'winner_payout', role: 'winner_settlement', missingRequestDigest: false },
	{ operationId: '1e219fc0d4363c4c7f04393b393ee42ee99efcdcae00d9d0c5820b87da16abd9', branch: 'winner_payout', role: 'winner_settlement', missingRequestDigest: true },
	{ operationId: '800231905a7524fe084f3de3751e7c373be25d86bff5786d1b386b105a435ef7', branch: 'outbid_return', role: 'refund', missingRequestDigest: false },
	{ operationId: '9c45474d1c67d84ae034c509cd27d917851d7f301db4bb5d396450564a92ea3b', branch: 'rejected_return', role: 'refund', missingRequestDigest: false },
	{ operationId: '0784a4ffade955f0f06da01bacd046f6fa085abbb5ff7e86edf5bf755b078214', branch: 'winner_payout', role: 'winner_settlement', missingRequestDigest: false },
	{ operationId: 'f32eb19b8351da454f3da88642942aea9a13562c91b557283fd0d45d34825f87', branch: 'winner_payout', role: 'winner_settlement', missingRequestDigest: false },
	{ operationId: '245bc39cf486c6426837699cc99ee26c822f6e4a7f717a2491700d990ae1e804', branch: 'outbid_return', role: 'refund', missingRequestDigest: true },
] as const)

function digest(label: string): string { return createHash('sha256').update(label).digest('hex') }

function scalar(index: number): Uint8Array {
	return hexToBytes((index + 1).toString(16).padStart(64, '0'))
}

describe('seven legacy recipient-pending terminal notices', () => {
	test('survive restart, await genuine acknowledgements, and complete without another mint effect', async () => {
		const root = await mkdtemp(join(tmpdir(), 'friday-legacy-recipient-pending.'))
		const coordinatorPath = join(root, 'operations.sqlite3')
		const exchangePath = join(root, 'terminal-exchange.sqlite3')
		const scopes = new Map<string, string>()
		const recipientSecrets = new Map<string, Uint8Array>()
		try {
			let coordinatorDb = new Database(coordinatorPath, { create: true, strict: true })
			let exchangeDb = new Database(exchangePath, { create: true, strict: true })
			let coordinator = new DemoFridayCoordinatorSqlite(coordinatorDb, DEPLOYMENT)
			let exchange = new DemoFridayCocoTerminalExchangeSqlite(exchangeDb, DEPLOYMENT)

			for (const [index, fixture] of LEGACY.entries()) {
				const scope = `legacy-${String(index + 1).padStart(2, '0')}`
				const actor = digest(`actor:${fixture.operationId}`)
				const recipientSecret = scalar(index + 10)
				const recipientPublicKey = bytesToHex(secp256k1.getPublicKey(recipientSecret, true))
				scopes.set(fixture.operationId, scope)
				recipientSecrets.set(fixture.operationId, recipientSecret)
				coordinator.enqueueAuthorized({
					scope, authorityOperationId: fixture.operationId, paymentOperationId: fixture.operationId,
					recipientActorId: actor, operationRoot: digest(`operation:${fixture.operationId}`),
					frostOperationRoot: digest(`frost:${fixture.operationId}`), bundleDigest: digest(`bundle:${fixture.operationId}`),
					branch: fixture.branch as DemoFridayTerminalBranch, chainId: 'plebeian-auctions-mvp-20261102',
					executionBindingDigest: digest(`binding:${fixture.operationId}`),
					preparedAuthorizationDigest: digest(`authorization:${fixture.operationId}`),
					selectionRoot: digest(`selection:${fixture.operationId}`), outcomeHeight: 100 + index,
				})
				coordinator.transition(scope, ['queued'], (record) => {
					record.phase = 'recipient_pending'
					record.attempts = 1
					record.terminalResponseDigest = digest(`terminal:${fixture.operationId}`)
					if (!fixture.missingRequestDigest) record.requestDigest = digest(`request:${fixture.operationId}`)
				})
				exchange.publishExact({
					schema: 'PLEBEIAN_FRIDAY_COCO_TERMINAL_NOTICE_V1', actor,
					network: 'friday', chainId: 'plebeian-auctions-mvp-20261102', auctionId: `legacy-auction-${index + 1}`,
					operationId: fixture.operationId, role: fixture.role, mintUrl: 'https://mint.example', amount: index + 1,
					recipientCapabilityDigest: digest(`capability:${fixture.operationId}`),
					signatures: [{ amount: index + 1, id: 'legacy-keyset', C_: bytesToHex(secp256k1.getPublicKey(scalar(index + 30), true)) }],
				}, recipientPublicKey)
			}

			// Simulate the release restart before touching any legacy acknowledgement.
			coordinatorDb.close(false); exchangeDb.close(false)
			coordinatorDb = new Database(coordinatorPath, { create: false, strict: true })
			exchangeDb = new Database(exchangePath, { create: false, strict: true })
			coordinator = new DemoFridayCoordinatorSqlite(coordinatorDb, DEPLOYMENT)
			exchange = new DemoFridayCocoTerminalExchangeSqlite(exchangeDb, DEPLOYMENT)

			const restarted = coordinator.listNonterminal()
			expect(restarted.map((record) => record.paymentOperationId)).toEqual(LEGACY.map((fixture) => fixture.operationId))
			expect(restarted.filter((record) => record.branch === 'winner_payout')).toHaveLength(4)
			expect(restarted.filter((record) => record.branch !== 'winner_payout')).toHaveLength(3)
			for (const fixture of LEGACY) {
				const record = coordinator.read(scopes.get(fixture.operationId)!)!
				expect(record.authorityOperationId).toBe(fixture.operationId)
				expect(record.paymentOperationId).toBe(fixture.operationId)
				expect(record.terminalResponseDigest).toBe(digest(`terminal:${fixture.operationId}`))
				expect(record.requestDigest === undefined).toBe(fixture.missingRequestDigest)
				expect(exchange.hasAck(fixture.operationId)).toBe(false)
			}

			let executeEffects = 0
			let recoveryEffects = 0
			let importChecks = 0
			const ports: DemoFridayCoordinatorPorts = {
				async executeExact() { executeEffects += 1; throw new Error('legacy terminal must not execute another mint effect') },
				async recoverExact() { recoveryEffects += 1; throw new Error('legacy terminal must not recover through a fresh mint effect') },
				async importExact(record) {
					importChecks += 1
					if (!exchange.hasAck(record.paymentOperationId)) return { status: 'recipient_pending' }
					return { status: 'completed', recipientImportDigest: digest(`import:${record.paymentOperationId}`) }
				},
			}
			const worker = createDemoFridayCoordinatorWorker(coordinator, ports)

			// Merely restarting/reconciling an absent acknowledgement is read-only.
			for (const fixture of LEGACY) {
				const scope = scopes.get(fixture.operationId)!
				const before = coordinator.read(scope)!
				expect(await worker.reconcileExact(scope)).toEqual(before)
			}
			expect({ executeEffects, recoveryEffects, importChecks }).toEqual({ executeEffects: 0, recoveryEffects: 0, importChecks: 7 })

			// A real recipient-key signature over the exact notice/receipt is the only
			// event that permits each already-minted legacy operation to complete.
			for (const [index, fixture] of LEGACY.entries()) {
				const scope = scopes.get(fixture.operationId)!
				const record = coordinator.read(scope)!
				const notice = exchange.readExact({ actor: record.recipientActorId, fundingOperationId: fixture.operationId })!
				const recipientSecret = recipientSecrets.get(fixture.operationId)!
				const recipientPublicKey = bytesToHex(secp256k1.getPublicKey(recipientSecret, true))
				const noticeDigest = demoFridayCocoTerminalNoticeDigest(notice)
				const receipt = {
					schema: 'COCO_DEMO_RECIPIENT_IMPORT_RECEIPT_V1' as const, operationId: fixture.operationId,
					role: fixture.role, recipientPublicKey, amount: index + 1, proofCount: 1, imported: true as const,
				}
				exchange.acknowledgeExact({
					schema: 'PLEBEIAN_FRIDAY_COCO_TERMINAL_ACK_V1', actor: notice.actor,
					fundingOperationId: fixture.operationId, noticeDigest, importReceipt: receipt,
					recipientAckSignature: bytesToHex(schnorr.sign(hexToBytes(
						demoFridayCocoTerminalAckDigest(noticeDigest, receipt),
					), recipientSecret)),
				})
				const completed = await worker.reconcileExact(scope)
				expect(completed.phase).toBe('completed')
				expect(completed.authorityOperationId).toBe(fixture.operationId)
				expect(completed.paymentOperationId).toBe(fixture.operationId)
				expect(completed.terminalResponseDigest).toBe(record.terminalResponseDigest)
				expect(completed.requestDigest).toBe(record.requestDigest)
				expect(completed.recipientImportDigest).toBe(digest(`import:${fixture.operationId}`))
			}
			expect({ executeEffects, recoveryEffects, importChecks }).toEqual({ executeEffects: 0, recoveryEffects: 0, importChecks: 14 })

			coordinatorDb.close(false); exchangeDb.close(false)
			coordinatorDb = new Database(coordinatorPath, { create: false, strict: true })
			exchangeDb = new Database(exchangePath, { create: false, strict: true })
			coordinator = new DemoFridayCoordinatorSqlite(coordinatorDb, DEPLOYMENT)
			for (const fixture of LEGACY) {
				const record = coordinator.read(scopes.get(fixture.operationId)!)!
				expect(record.phase).toBe('completed')
				expect(record.paymentOperationId).toBe(fixture.operationId)
				expect(record.requestDigest === undefined).toBe(fixture.missingRequestDigest)
			}
			coordinatorDb.close(false); exchangeDb.close(false)
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})
})
