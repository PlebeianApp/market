import { describe, expect, test } from 'bun:test'
import { STOREFRONT_THEME_IDS } from '@/lib/schemas/storefront'
import { StorefrontBlockSchema, createEmptyStorefrontPage, validateStorefrontPageForPublish } from '@/lib/schemas/storefront'
import { getStorefrontTemplate, instantiateStorefrontTemplate, STOREFRONT_TEMPLATES } from './storefrontTemplates'

describe('STOREFRONT_TEMPLATES registry', () => {
	test('every template has a label, a description, and a theme id from the closed set', () => {
		for (const template of STOREFRONT_TEMPLATES) {
			expect(template.label.length, template.id).toBeGreaterThan(0)
			expect(template.description.length, template.id).toBeGreaterThan(0)
			expect(STOREFRONT_THEME_IDS as readonly string[], template.id).toContain(template.defaultThemeId)
		}
	})

	test('template ids are unique', () => {
		const ids = STOREFRONT_TEMPLATES.map((t) => t.id)
		expect(new Set(ids).size).toBe(ids.length)
	})

	test('includes a blank starting point with no blocks', () => {
		const blank = STOREFRONT_TEMPLATES.find((t) => t.id === 'blank')
		expect(blank?.blocks).toEqual([])
	})
})

describe('instantiateStorefrontTemplate', () => {
	test('every instantiated block validates against the live block schema', () => {
		// This is the test that actually protects the wizard: a template whose
		// placeholder props drifted from the schema (a renamed field, a changed
		// enum) fails here instead of silently handing the author a page that
		// loses blocks the moment they publish.
		for (const template of STOREFRONT_TEMPLATES) {
			const instantiated = instantiateStorefrontTemplate(template)
			for (const block of instantiated) {
				const result = StorefrontBlockSchema.safeParse(block)
				expect(result.success, `${template.id} / ${block.type}: ${!result.success && JSON.stringify(result.error.issues)}`).toBe(true)
			}
		}
	})

	test('produces unique block ids within one instantiation, even when the source template repeats a placeholder id', () => {
		const shop = getStorefrontTemplate('shop')
		const ids = instantiateStorefrontTemplate(shop).map((b) => b.props.id)
		expect(new Set(ids).size).toBe(ids.length)
	})

	test('never reuses ids across two separate instantiations of the same template', () => {
		const shop = getStorefrontTemplate('shop')
		const first = instantiateStorefrontTemplate(shop).map((b) => b.props.id)
		const second = instantiateStorefrontTemplate(shop).map((b) => b.props.id)
		expect(first.some((id) => second.includes(id))).toBe(false)
	})

	test('preserves block type and order', () => {
		const shop = getStorefrontTemplate('shop')
		const instantiated = instantiateStorefrontTemplate(shop)
		expect(instantiated.map((b) => b.type)).toEqual(shop.blocks.map((b) => b.type))
	})

	test('a page built from any template and its default theme passes strict publish validation', () => {
		// The actual promise the wizard makes: whatever a author picks is always
		// immediately publishable, never a draft that validates at render but
		// fails strict validation the moment they hit Publish unedited.
		for (const template of STOREFRONT_TEMPLATES) {
			const page = {
				...createEmptyStorefrontPage(),
				enabled: true,
				root: { props: { title: '', theme: template.defaultThemeId } },
				content: instantiateStorefrontTemplate(template),
			}
			const result = validateStorefrontPageForPublish(page)
			expect(result.ok, `${template.id}: ${!result.ok && result.errors.join('; ')}`).toBe(true)
		}
	})
})

describe('getStorefrontTemplate', () => {
	test('returns the matching template for a valid id', () => {
		expect(getStorefrontTemplate('shop').id).toBe('shop')
	})

	test('falls back to the first template for an id outside the closed set', () => {
		expect(getStorefrontTemplate('nonexistent').id).toBe(STOREFRONT_TEMPLATES[0].id)
	})

	test('falls back to the first template for undefined', () => {
		expect(getStorefrontTemplate(undefined).id).toBe(STOREFRONT_TEMPLATES[0].id)
	})
})
