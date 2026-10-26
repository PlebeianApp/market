/**
 * registry.test.ts — **the contribution path's own falsification table** (`increments.md` V2).
 *
 * Each case names, in its first comment, the careless implementation that turns it red. What is proved
 * here is the guard the seed's bare `throw` becomes, widened by the declared contribution path: one owner
 * per kind, an undeclared overlap refused by the closed `(kind, claimed-by-two)` pair, both halves of a
 * contribution required, and a bad declaration refused **at boot, before any candidate is judged**.
 */
import { describe, expect, test } from 'bun:test'

import { DEFAULT_WRITE_BACK } from '../../event-access/ts/index'
import { modelEndpoint, recordingUpstream } from '../../event-access/ts/harness'
import type { ValidationCheck } from '../../validation/ts/index'
import { composeCommerce } from './compose'
import { createPresetRegistry, DeclarationError } from './registry'
import type { CommerceValidationDeclaration } from './declaration'

const EMPTY = (owner: string): CommerceValidationDeclaration => ({ owner, kinds: [], contributions: [], accepts: [] })
const OWNS = (owner: string, kind: number, checks: readonly ValidationCheck[] = []): CommerceValidationDeclaration => ({
	owner,
	kinds: [{ kind, source: `${owner} spec`, checks }],
	contributions: [],
	accepts: [],
})

describe('the declaration registry and its guard', () => {
	test('an undeclared overlap is refused at boot, naming the closed (kind, claimed-by-two) pair', () => {
		// Careless implementation it fails on: one that merges last-wins (the seed's bare `throw` widened
		// into a silent overwrite), so two owners of one kind resolve to whichever registered second.
		const first = OWNS('commerce.products', 30402)
		const second = OWNS('commerce.discovery', 30402)
		let thrown: unknown
		try {
			createPresetRegistry({ declarations: [first, second] })
		} catch (error) {
			thrown = error
		}
		expect(thrown).toBeInstanceOf(DeclarationError)
		const refusal = (thrown as DeclarationError).refusal
		expect(refusal.reason).toBe('claimed-by-two')
		expect(refusal.kind).toBe(30402)
		expect(refusal.claimedBy).toEqual(['commerce.products', 'commerce.discovery'])
	})

	test('an uninterpretable check is refused before any candidate is judged (no event is needed)', () => {
		// Careless implementation it fails on: one that defers the comparator check to the per-event
		// verdict, so a host's configuration error surfaces as a refusal of every candidate.
		const bad: ValidationCheck = {
			kind: 'link',
			id: 'bad-comparator',
			tag: 'e',
			index: 1,
			strategy: 'by-id',
			// A comparator the closed vocabulary (eq · exists · in) does not carry.
			compare: [{ candidate: { tag: 'e', index: 1 }, reference: 'id', comparator: 'matches' as 'eq' }],
		}
		expect(() => createPresetRegistry({ declarations: [OWNS('commerce.auctions', 30408, [bad])] })).toThrow(DeclarationError)

		// and the same for the other two uninterpretable shapes: a chain depth above one hop, and a
		// declaration whose reference count is past the fan-out ceiling.
		const deepChain: CommerceValidationDeclaration = { ...OWNS('commerce.auctions', 30408), bounds: { maxChainDepth: 2 } }
		expect(() => createPresetRegistry({ declarations: [deepChain] })).toThrow(DeclarationError)

		const wide: CommerceValidationDeclaration = {
			...OWNS('commerce.auctions', 30408),
			bounds: { maxReferencesPerEvent: 1 },
			kinds: [
				{
					kind: 30408,
					source: 'x',
					checks: [
						{ kind: 'link', id: 'a', tag: 'e', index: 1, strategy: 'by-id' },
						{ kind: 'link', id: 'b', tag: 'e', index: 2, strategy: 'by-id' },
					],
				},
			],
		}
		expect(() => createPresetRegistry({ declarations: [wide] })).toThrow(DeclarationError)
	})

	test('a routed demand needs BOTH halves: a contribution is ungranted without the owner’s `accepts`', () => {
		// Careless implementation it fails on: one that accepts a `Contribution` on its `via` name alone,
		// so any module can attach its checks to any other module's kind without the owner agreeing.
		const owner = OWNS('commerce.messaging', 16)
		const contributor: CommerceValidationDeclaration = {
			owner: 'commerce.orders',
			kinds: [],
			contributions: [{ kind: 16, via: 'commerce.messaging', source: 'orders spec', checks: [] }],
			accepts: [],
		}
		let thrown: unknown
		try {
			createPresetRegistry({ declarations: [owner, contributor] })
		} catch (error) {
			thrown = error
		}
		expect((thrown as DeclarationError).refusal.reason).toBe('contribution-ungranted')

		// the mirror: a grant naming a contributor that contributes nothing is refused too.
		const granting: CommerceValidationDeclaration = { ...owner, accepts: [{ from: 'commerce.orders', kinds: [16] }] }
		let other: unknown
		try {
			createPresetRegistry({ declarations: [granting, EMPTY('commerce.orders')] })
		} catch (error) {
			other = error
		}
		expect((other as DeclarationError).refusal.reason).toBe('grant-without-contribution')
	})

	test('a granted contribution merges into the OWNER’s declaration, and the owner stays the owner', () => {
		// Careless implementation it fails on: one that makes the contributor a second owner (two presets
		// for one kind), or that drops the contributor's checks instead of merging them.
		const owner: CommerceValidationDeclaration = {
			owner: 'commerce.messaging',
			kinds: [{ kind: 16, source: 'messaging spec', checks: [] }],
			contributions: [],
			accepts: [{ from: 'commerce.orders', kinds: [16] }],
		}
		const contributor: CommerceValidationDeclaration = {
			owner: 'commerce.orders',
			kinds: [],
			contributions: [
				{
					kind: 16,
					via: 'commerce.messaging',
					source: 'orders spec',
					checks: [{ kind: 'format', id: 'orders-needs-subject', requires: [{ tag: 'subject', atLeast: 1 }] }],
				},
			],
			accepts: [],
		}
		// order-independent: the contributor may be collected before its owner.
		const registry = createPresetRegistry({ declarations: [contributor, owner] })
		const snapshot = registry.snapshot()
		expect(snapshot.map((preset) => [preset.name, preset.kinds])).toEqual([['commerce.messaging:16', [16]]])
		expect(snapshot[0].checks.map((check) => check.id)).toEqual(['orders-needs-subject'])

		const report = registry.report()
		expect(report.owned.map((record) => record.owner)).toEqual(['commerce.messaging'])
		expect(report.owned[0].checks).toBe(1) // the merged count, not the owner's own zero
		expect(report.contributions).toEqual([{ owner: 'commerce.messaging', contributor: 'commerce.orders', kind: 16, source: 'orders spec' }])
		expect(report.grants).toEqual([{ owner: 'commerce.messaging', contributor: 'commerce.orders', kinds: [16] }])
	})

	test('report() is a value a test reads: owned, owned-with-no-rules, contributions, grants and unplaced', () => {
		const registry = createPresetRegistry({
			declarations: [OWNS('commerce.products', 30402), { ...OWNS('commerce.shipping', 30406), kinds: [] }],
			rendered: [30402, 30408, 9999],
		})
		const report = registry.report()
		expect([...report.owners].sort()).toEqual(['commerce.products', 'commerce.shipping'])
		expect(report.owned.map((record) => record.kind)).toEqual([30402])
		// 30402 is owned with `checks: []` — a declared "demands nothing", listed rather than silent.
		expect(report.ownedWithNoRules.map((record) => record.kind)).toEqual([30402])
		// `unplaced` is rendered − owned: 30408 and 9999 are rendered but owned by no declaration.
		expect([...report.unplaced].sort()).toEqual([30408, 9999])
	})

	test('withdraw restores the engine’s pass-through for that kind', () => {
		const registry = createPresetRegistry({ declarations: [OWNS('commerce.products', 30402)] })
		expect(registry.snapshot()).toHaveLength(1)
		registry.withdraw('commerce.products', 30402)
		expect(registry.snapshot()).toEqual([])
		expect(registry.report().owned).toEqual([])
	})

	test('composeCommerce preserves R1: zero declarations ⇒ the socket stays absent and the policy IS DEFAULT_WRITE_BACK', () => {
		// Careless implementation it fails on: one that always passes `validation: { presets }` — an empty
		// snapshot then installs a pass-through hook, making `access.policy` a lookalike of the default.
		const endpoint = modelEndpoint({ events: [] })
		const upstream = recordingUpstream({ events: [] })
		const composed = composeCommerce({ declarations: [], endpoint: endpoint.endpoint, upstream: upstream.upstream })
		expect(composed.gated).toBe(false)
		expect(composed.access.policy.accept).toBeUndefined()
		expect(composed.access.policy).toEqual(DEFAULT_WRITE_BACK)
	})
})
