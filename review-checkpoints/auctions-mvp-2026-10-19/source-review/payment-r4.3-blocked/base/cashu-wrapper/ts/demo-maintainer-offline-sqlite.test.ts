import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
	createDemoMaintainerOfflineSqliteStore,
	createDemoRecipientPrivateSqliteJournal,
	createDemoSigAllRecoverySqliteStore,
	type DemoSqliteJsonValue,
} from './demo-maintainer-offline-sqlite'
import type { DemoMaintainerExactTemplateBundle, DemoMaintainerOutcomeSelection } from './demo-maintainer-offline'
import type { DemoMaintainerFederationAuthorization } from './demo-maintainer-federation'
import type { DemoSigAllRecoveryRecord } from './demo-sigall-recovery'
import type { DemoRecipientPrivateRecord } from './demo-sigall-recipient'

const roots: string[] = []
const digest = (value: string): string => value.repeat(64)
const point = (value: string): string => `02${value.repeat(64)}`
const key = (value: number): Uint8Array => new Uint8Array(32).fill(value)

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function databasePath(name: string): string {
	const root = mkdtempSync(join(tmpdir(), 'coco-demo-durable-'))
	roots.push(root)
	return join(root, name)
}

function fixtureBundle(): DemoMaintainerExactTemplateBundle {
	// The domain executor validates the full exact bundle on load. This store test intentionally
	// exercises only durable identity, conflict, encryption, and monotonic update semantics.
	return { bundleDigest: digest('a') } as DemoMaintainerExactTemplateBundle
}

function fixtureRecovery(revision = 0): DemoSigAllRecoveryRecord {
	return {
		schema: 'COCO_DEMO_SIGALL_RECOVERY_V1', revision,
		scope: 'network\0chain\0auction\0operation', operationRoot: digest('b'), requestDigest: digest('c'),
		mintUrl: 'https://mint.invalid', operationId: 'operation-1', locktime: 900,
		cashuSigAllDigest: digest('d'), recipientCapabilityDigest: digest('e'),
		proofStateRefs: [point('1')], blindedOutputs: [{ amount: 8, id: 'keyset-1', B_: point('2') }],
		state: revision === 0 ? 'prepared' : 'attempting', attemptNumber: revision,
		preparedAt: 100, updatedAt: 100 + revision,
	}
}

interface Opening { secret: string; blinding: string }

const openingCodec = {
	encode(value: Opening): DemoSqliteJsonValue { return { secret: value.secret, blinding: value.blinding } },
	decode(value: DemoSqliteJsonValue): Opening {
		if (typeof value !== 'object' || value === null || Array.isArray(value)
			|| typeof value.secret !== 'string' || typeof value.blinding !== 'string') throw new Error('opening-codec-invalid')
		return { secret: value.secret, blinding: value.blinding }
	},
}

function fixtureRecipient(scope: string): DemoRecipientPrivateRecord<Opening> {
	return {
		schema: 'COCO_DEMO_RECIPIENT_PRIVATE_RECORD_V1', scope,
		intentDigest: digest('3'), requestDigest: digest('4'), keysetDigest: digest('5'),
		coordinatorRequest: {
			capability: {
				schema: 'COCO_DEMO_RECIPIENT_CAPABILITY_V1', network: 'demo-network', chainId: 'demo-chain',
				auctionId: 'auction-1', operationId: 'operation-1', role: 'winner_settlement',
				mintUrl: 'https://mint.invalid', unit: 'sat', recipientPublicKey: point('6'), outputsDigest: digest('7'), signature: '8'.repeat(128),
			},
			outputs: [{ amount: 8, id: 'keyset-1', B_: point('9') }],
		},
		privateOpeningRefs: [{ secret: 'recipient-private-secret', blinding: 'recipient-private-blinding' }],
	}
}

describe('encrypted SQLite durability for the offline payment lane', () => {
	test('persists the exact bundle, outcome, fresh session, and threshold-three authorization across reconstruction', async () => {
		const path = databasePath('maintainer.sqlite')
		const bundle = fixtureBundle()
		const store = createDemoMaintainerOfflineSqliteStore({ databasePath: path, encryptionKey: key(1), nowSeconds: () => 100 })
		await store.persistPrepared('scope-1', bundle, { notAfter: 200 })
		const selection: DemoMaintainerOutcomeSelection = {
			schema: 'COCO_DEMO_MAINTAINER_OUTCOME_SELECTION_V1', selectionRoot: digest('f'), templateDigest: digest('0'),
			outcome: { schema: 'COCO_DEMO_MAINTAINER_FINAL_OUTCOME_V1' } as DemoMaintainerOutcomeSelection['outcome'],
		}
		await store.bindOutcome('scope-1', bundle.bundleDigest, selection)
		const attempt = await store.reserveFederationAttempt('scope-1', bundle.bundleDigest, selection.selectionRoot, 4)
		const authorization: DemoMaintainerFederationAuthorization = {
			schema: 'COCO_DEMO_MAINTAINER_FEDERATION_AUTHORIZATION_V1', threshold: 3,
			participantIds: [1, 2, 3], sessionId: attempt.sessionId, packageDigest: digest('1'), cashuSigAllDigest: digest('2'),
			committeeKeysetId: 'keyset-1', committeeKeysetVersion: 'version-1', transcriptHash: digest('3'), signature: '4'.repeat(128),
		}
		await store.saveAuthorization('scope-1', bundle.bundleDigest, selection.selectionRoot, authorization)
		store.close()

		const restarted = createDemoMaintainerOfflineSqliteStore({ databasePath: path, encryptionKey: key(1), nowSeconds: () => 101 })
		const held = await restarted.loadExact('scope-1', bundle.bundleDigest)
		expect(held?.selection).toEqual(selection)
		expect(held?.federationAttempts).toEqual([attempt])
		expect(held?.authorization).toEqual(authorization)
		expect(held?.authorization?.threshold).toBe(3)
		expect((statSync(path).mode & 0o777)).toBe(0o600)
		expect(readFileSync(path).includes(Buffer.from(bundle.bundleDigest))).toBe(false)
		restarted.close()
	})

	test('recovery compare-and-swap survives restart and rejects stale revisions', async () => {
		const path = databasePath('recovery.sqlite')
		const first = createDemoSigAllRecoverySqliteStore({ databasePath: path, encryptionKey: key(2) })
		expect((await first.createOrGet(fixtureRecovery())).created).toBe(true)
		expect(await first.compareAndSwap(fixtureRecovery().scope, 0, fixtureRecovery(1))).toBe(true)
		expect(await first.compareAndSwap(fixtureRecovery().scope, 0, fixtureRecovery(1))).toBe(false)
		first.close()
		const second = createDemoSigAllRecoverySqliteStore({ databasePath: path, encryptionKey: key(2) })
		expect(await second.read(fixtureRecovery().scope)).toEqual(fixtureRecovery(1))
		second.close()
	})

	test('recipient openings remain encrypted, import is idempotent, and a wrong key fails closed', async () => {
		const path = databasePath('recipient.sqlite')
		const scope = 'recipient-private-scope'
		const record = fixtureRecipient(scope)
		const first = createDemoRecipientPrivateSqliteJournal({ databasePath: path, encryptionKey: key(3), openingCodec })
		await first.runExclusive(scope, async () => {
			await first.savePrepared(scope, record)
			await first.markImported(scope, record.requestDigest, digest('a'))
		})
		first.close()
		const raw = readFileSync(path)
		expect(raw.includes(Buffer.from('recipient-private-secret'))).toBe(false)
		expect(raw.includes(Buffer.from('recipient-private-blinding'))).toBe(false)

		const restarted = createDemoRecipientPrivateSqliteJournal({ databasePath: path, encryptionKey: key(3), openingCodec })
		expect((await restarted.load(scope))?.privateOpeningRefs).toEqual(record.privateOpeningRefs)
		await restarted.runExclusive(scope, () => restarted.markImported(scope, record.requestDigest, digest('a')))
		restarted.close()

		const wrong = createDemoRecipientPrivateSqliteJournal({ databasePath: path, encryptionKey: key(4), openingCodec })
		await expect(wrong.load(scope)).rejects.toThrow('DEMO_SQLITE_AUTHENTICATION')
		wrong.close()
	})
})
