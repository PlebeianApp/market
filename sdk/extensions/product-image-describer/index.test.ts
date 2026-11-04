import { describe, expect, test } from 'bun:test'
import { executeExtensionAction, parseExtensionConfig, validateExtensionDefinition } from '../../core/extensions'
import { createTestActionContext, testCaller } from '../../core/testing/extensionHost'
import { mockDescribeImage, productImageDescriber, productImageDescriberManifest } from '.'

const context = createTestActionContext({ publicConfig: { maxChars: 600 } })
const run = (rawInput: unknown) =>
	executeExtensionAction({ actions: productImageDescriber.actions, actionName: 'describe-image', rawInput, caller: testCaller(), context })

describe('product-image-describer extension', () => {
	test('is a valid definition with a bundled logo and no host ports', () => {
		expect(validateExtensionDefinition(productImageDescriber).ok).toBe(true)
		expect(productImageDescriberManifest.icon).toBe('/images/extension-product-image-describer.svg')
		expect('hostPorts' in productImageDescriberManifest).toBe(false)
	})

	test('coerces env-style public config and applies the default', () => {
		expect(parseExtensionConfig(productImageDescriberManifest, { publicConfig: { maxChars: '300' } })).toMatchObject({
			ok: true,
			value: { publicConfig: { maxChars: 300 } },
		})
		expect(parseExtensionConfig(productImageDescriberManifest, {})).toMatchObject({ ok: true, value: { publicConfig: { maxChars: 600 } } })
		expect(parseExtensionConfig(productImageDescriberManifest, { publicConfig: { maxChars: '5' } }).ok).toBe(false)
	})

	test('drafts a labelled mock description from the title, category, and notes', async () => {
		const result = await run({
			imageUrl: 'https://cdn.example/img/IMG_2041.jpg',
			title: 'Hand-thrown ceramic mug',
			category: 'Kitchen',
			notes: 'dishwasher safe, holds 350ml',
		})
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const output = result.value as ReturnType<typeof mockDescribeImage>
		expect(output).toMatchObject({ provider: 'mock', mock: true, basis: ['title', 'category', 'notes'] })
		expect(output.description).toContain('a Hand-thrown ceramic mug from our kitchen range.')
		expect(output.description).toContain('Dishwasher safe, holds 350ml.')
	})

	test('falls back to filename words, ignoring hashes and camera noise', () => {
		expect(mockDescribeImage({ imageUrl: 'https://cdn.example/walnut-cutting-board_final.webp' }, 600)).toMatchObject({
			basis: ['filename'],
			description: expect.stringContaining('a walnut cutting board.'),
		})
		const hashed = mockDescribeImage({ imageUrl: `https://blossom.example/${'ab12'.repeat(16)}.png` }, 600)
		expect(hashed.basis).toEqual([])
		expect(hashed.description).toContain('this product.')
	})

	test('is deterministic and respects maxChars', () => {
		const input = { imageUrl: 'https://cdn.example/oak-table.jpg', notes: 'x '.repeat(200) }
		expect(mockDescribeImage(input, 600)).toEqual(mockDescribeImage(input, 600))
		const short = mockDescribeImage(input, 120)
		expect(short.description.length).toBeLessThanOrEqual(120)
		expect(short.description.endsWith('…')).toBe(true)
	})

	test('rejects non-http image URLs and oversized fields before drafting', async () => {
		for (const rawInput of [
			{ imageUrl: 'javascript:alert(1)' },
			{ imageUrl: 'https://user:pw@cdn.example/a.jpg' },
			{ imageUrl: 'https://cdn.example/a.jpg', title: 'x'.repeat(201) },
			{},
		]) {
			expect(await run(rawInput)).toMatchObject({ ok: false, error: { reason: 'invalid_input' } })
		}
	})
})
