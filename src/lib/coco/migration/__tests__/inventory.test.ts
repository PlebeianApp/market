import { describe, expect, test } from 'bun:test'
import {
	REQUIRED_PRODUCTION_ENUMERATORS,
	MigrationSafetyError,
	enumerateProductionInventory,
	invalidateSealForLateDiscovery,
	sealProductionInventory,
	verifyInventorySeal,
} from '..'
import { IDENTITY, createInventoryPort, item, projection } from './fixtures'

describe('production inventory', () => {
	test('runs every required trusted enumerator and seals its completion evidence', async () => {
		const run = await enumerateProductionInventory(IDENTITY, createInventoryPort(), 100)
		expect(run.completions.map((completion) => completion.source)).toEqual(Array.from(REQUIRED_PRODUCTION_ENUMERATORS))
		expect(run.completions.every((completion) => completion.itemCount === 0)).toBe(true)
		const seal = await sealProductionInventory(run, 2, 101)
		expect(seal.itemCount).toBe(0)
		expect(seal.commitment).toMatch(/^sha256:[0-9a-f]{64}$/)
	})

	test('rejects one source identity appearing in two authoritative stores', async () => {
		const port = createInventoryPort({
			LEGACY_SPENDABLE_PROOFS: projection([item('same-source')]),
			LEGACY_RESERVATIONS: projection([item('same-source')]),
		})
		await expect(enumerateProductionInventory(IDENTITY, port)).rejects.toMatchObject({ code: 'DUPLICATE_SOURCE' })
	})

	test('rejects duplicate opening Coco baselines for one mint and unit', async () => {
		const port = createInventoryPort({
			COCO_OPENING_BASELINE: projection([item('opening-a'), item('opening-b')]),
		})
		const run = await enumerateProductionInventory(IDENTITY, port)
		await expect(sealProductionInventory(run, 1)).rejects.toMatchObject({ code: 'DUPLICATE_SOURCE' })
	})

	test('late discovery invalidates a previous seal while an idempotent rediscovery does not', async () => {
		const run = await enumerateProductionInventory(
			IDENTITY,
			createInventoryPort({ LEGACY_SPENDABLE_PROOFS: projection([item('known-source')]) }),
		)
		const seal = await sealProductionInventory(run, 1)
		expect(invalidateSealForLateDiscovery(seal, 'known-source')).toBe(seal)
		expect(invalidateSealForLateDiscovery(seal, 'late-source').lateDiscoveries).toEqual(['late-source'])
	})

	test('canonicalizes mint and unit identity and rejects malformed percent encoding', async () => {
		const run = await enumerateProductionInventory(
			IDENTITY,
			createInventoryPort({
				LEGACY_SPENDABLE_PROOFS: projection([item('canonical', { mint: 'https://MINT.EXAMPLE/', unit: 'SAT' })]),
			}),
		)
		expect(run.items[0].mint).toBe('https://mint.example')
		expect(run.items[0].unit).toBe('sat')

		const malformed = createInventoryPort({
			LEGACY_SPENDABLE_PROOFS: projection([item('malformed', { mint: 'https://mint.example/%xx' })]),
		})
		await expect(enumerateProductionInventory(IDENTITY, malformed)).rejects.toBeInstanceOf(MigrationSafetyError)
		await expect(
			enumerateProductionInventory({ ...IDENTITY, namespace: 'arbitrary-wallet-label' }, createInventoryPort()),
		).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' })
	})

	test('preserves blockers from reservations, pending outbound, and historical P2PK recovery', async () => {
		const run = await enumerateProductionInventory(
			IDENTITY,
			createInventoryPort({
				LEGACY_RESERVATIONS: projection([item('reservation', { state: 'LOCKED' })]),
				LEGACY_PENDING_OUTBOUND: projection([item('outbound', { state: 'PENDING', uncertainRemoteEffect: true })]),
				AUCTION_BIDDER_P2PK: projection([item('p2pk', { state: 'LOCKED', unresolvedP2pkRecovery: true })]),
			}),
		)
		expect(run.items.map((entry) => entry.sourceId)).toEqual(['reservation', 'outbound', 'p2pk'])
		expect(run.items[1].uncertainRemoteEffect).toBe(true)
		expect(run.items[2].unresolvedP2pkRecovery).toBe(true)
	})

	test('recomputes source and seal commitments before accepting durable evidence', async () => {
		const run = await enumerateProductionInventory(
			IDENTITY,
			createInventoryPort({ LEGACY_SPENDABLE_PROOFS: projection([item('source-1')]) }),
		)
		const seal = await sealProductionInventory(run, 1)
		await expect(verifyInventorySeal({ ...seal, commitment: `sha256:${'0'.repeat(64)}` })).rejects.toMatchObject({
			code: 'INVALID_INPUT',
		})
	})
})
