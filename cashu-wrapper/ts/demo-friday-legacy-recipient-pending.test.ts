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

const DEPLOYMENT = 'plebeian-friday-separated-20261103'

/**
 * Public identities from the 2026-11-05 read-only APP inventory.  These are
 * fixture labels, never bearer material.  Keeping the exact values catches an
 * accidental migration that would relabel an already-minted terminal effect.
 */
const LEGACY = Object.freeze([
	{ operationId: 'e82c3d5943e89c26087c5f12466273f7d0c5ba4907ef63771b46fbab36a58734', branch: 'winner_payout', role: 'winner_settlement', missingRequestDigest: false },
	{ operationId: '7572f156484ff2805e8935e5abef61d51f990a6cdb1e6bf53af100e68bba19ba', branch: 'winner_payout', role: 'winner_settlement', missingRequestDigest: true },
	{ operationId: '7a2ada64ee9134a10df6975800f598eee164b07ae9c67aa641cc1d382dccbf9f', branch: 'outbid_return', role: 'refund', missingRequestDigest: false },
	{ operationId: '63da655f8958810434ece0e0159436424d2b5aacfb3764a0d681f76f4429ffc1', branch: 'rejected_return', role: 'refund', missingRequestDigest: false },
	{ operationId: 'ec958664c1fb2ffef5a4ee1aa07e48d9f49af1cfc719a488e7aa410201d1f1bf', branch: 'winner_payout', role: 'winner_settlement', missingRequestDigest: false },
	{ operationId: '84069b68d726d7853a2566ef0d2d54e24d4ce7d2f1a295e17d36c5336e26c3d6', branch: 'winner_payout', role: 'winner_settlement', missingRequestDigest: false },
	{ operationId: '521b34e25d017adfd7453e6fc402f433001cfd0a28c16fe925c4bb59c3862e68', branch: 'outbid_return', role: 'refund', missingRequestDigest: true },
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
