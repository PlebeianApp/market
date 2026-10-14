/**
 * declarations.test.ts — **the corpus criterion, made checkable** (`increments.md` V2).
 *
 * Three facts, each with the mutation that turns it red:
 *
 * 1. **one module ↔ one declaration.** Each `sdk/commerce/<module>` directory exports exactly one
 *    `validationDeclaration`, and the collection names every module directory. Mutation: add a module
 *    directory without adding it to `validationDeclarations.ts` → red.
 * 2. **one parser file ↔ one `KindOwnership`.** No two declarations cite the same parser, and no kind is
 *    owned by two modules. Mutation: copy a parser citation onto a second kind → red; put one kind in two
 *    modules' `kinds` → red (the registry would refuse it as `claimed-by-two` anyway).
 * 3. **the tree's own arrangement registers without refusal**, through the declared contribution path —
 *    `orders` routes its demand for kinds 16/17 to `messaging`, and `messaging` admits it by name. Mutation:
 *    drop `messaging`'s `accepts` entry → `contribution-ungranted` is thrown at boot.
 */
import { describe, expect, test } from 'bun:test'
import { readdir } from 'node:fs/promises'

import { createPresetRegistry } from '../core/composition/ts/index'
import { commerceValidationDeclarations } from './validationDeclarations'

const HERE = import.meta.dir

async function moduleDirectories(): Promise<string[]> {
	const entries = await readdir(HERE, { withFileTypes: true })
	return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
}

describe('the sdk/commerce declarations', () => {
	test('one module ↔ one declaration: every module directory is named exactly once, and vice versa', async () => {
		const modules = await moduleDirectories()
		const owners = commerceValidationDeclarations.map((declaration) => declaration.owner)
		// The owner key is the module key — `commerce.<directory>` (design.md §7.5).
		expect([...owners].sort()).toEqual(modules.map((name) => `commerce.${name}`).sort())
		expect(new Set(owners).size).toBe(owners.length) // no duplicate owner
	})

	test('one parser file ↔ one KindOwnership: no parser citation and no owned kind is shared', () => {
		const citations = commerceValidationDeclarations.flatMap((declaration) =>
			declaration.kinds.flatMap((owned) => (owned.parser === undefined ? [] : [owned.parser])),
		)
		expect(new Set(citations).size).toBe(citations.length)

		const kinds = commerceValidationDeclarations.flatMap((declaration) => declaration.kinds.map((owned) => owned.kind))
		expect(new Set(kinds).size).toBe(kinds.length)

		// every ownership names exactly one source — a citation, never a second artifact beside the parser
		for (const declaration of commerceValidationDeclarations) {
			for (const owned of declaration.kinds) expect(owned.source.length).toBeGreaterThan(0)
		}
	})

	test("the tree's own arrangement registers without refusal through the declared contribution path", () => {
		// No refusal: the registry's guard passes over the whole collection.
		const registry = createPresetRegistry({ declarations: commerceValidationDeclarations })
		expect(registry.owners.length).toBe(commerceValidationDeclarations.length)

		// and the routed demand is the one `messaging` admits — both halves exist (design.md §4.5).
		const orders = commerceValidationDeclarations.find((declaration) => declaration.owner === 'commerce.orders')
		const messaging = commerceValidationDeclarations.find((declaration) => declaration.owner === 'commerce.messaging')
		expect(orders?.contributions.map((contribution) => contribution.kind).sort()).toEqual([16, 17])
		expect(messaging?.accepts).toEqual([{ from: 'commerce.orders', kinds: [16, 17] }])

		// the report names the routed demands as contributions of the owner's kinds, not as owners.
		const report = registry.report()
		expect(report.contributions.map((record) => [record.owner, record.contributor, record.kind])).toEqual([
			['commerce.messaging', 'commerce.orders', 16],
			['commerce.messaging', 'commerce.orders', 17],
		])
		expect(report.owned.some((record) => record.owner === 'commerce.orders')).toBe(false)
	})
})
