import { describe, expect, test } from 'bun:test'
import { parseMiniMarkdown, type MiniMarkdownInline } from './miniMarkdown'

/** Flattens a token tree back to its visible text, ignoring structure. */
function textOf(nodes: MiniMarkdownInline[]): string {
	return nodes
		.map((node) => {
			switch (node.kind) {
				case 'text':
					return node.value
				case 'code':
					return node.value
				default:
					return textOf(node.children)
			}
		})
		.join('')
}

describe('parseMiniMarkdown — HTML is never markup', () => {
	test('tags are literal text, not elements', () => {
		const blocks = parseMiniMarkdown('<script>alert(1)</script>')
		expect(blocks).toHaveLength(1)
		expect(blocks[0].kind).toBe('paragraph')
		// The characters survive verbatim; nothing in the tree is an element,
		// so the React renderer can only ever emit them as a text node.
		if (blocks[0].kind === 'paragraph') {
			expect(textOf(blocks[0].children)).toBe('<script>alert(1)</script>')
			expect(blocks[0].children.every((n) => n.kind === 'text')).toBe(true)
		}
	})

	test('an img with an onerror handler is text', () => {
		const blocks = parseMiniMarkdown('<img src=x onerror=alert(1)>')
		expect(blocks[0].kind).toBe('paragraph')
	})
})

describe('parseMiniMarkdown — links', () => {
	test('keeps a safe https link', () => {
		const blocks = parseMiniMarkdown('See [my shop](https://example.com/shop) today')
		expect(blocks[0].kind).toBe('paragraph')
		if (blocks[0].kind !== 'paragraph') return
		const link = blocks[0].children.find((n) => n.kind === 'link')
		expect(link).toBeDefined()
		if (link?.kind === 'link') {
			expect(link.href).toBe('https://example.com/shop')
			expect(textOf(link.children)).toBe('my shop')
		}
	})

	test('keeps an in-app path link', () => {
		const blocks = parseMiniMarkdown('[Browse](/products)')
		if (blocks[0].kind !== 'paragraph') throw new Error('expected paragraph')
		expect(blocks[0].children.some((n) => n.kind === 'link')).toBe(true)
	})

	test('a javascript: link degrades to emphasis, keeping the words but not the navigation', () => {
		const blocks = parseMiniMarkdown('[Click me](javascript:alert(1))')
		if (blocks[0].kind !== 'paragraph') throw new Error('expected paragraph')
		expect(blocks[0].children.some((n) => n.kind === 'link')).toBe(false)
		expect(textOf(blocks[0].children)).toContain('Click me')
	})

	test('a protocol-relative link is refused', () => {
		const blocks = parseMiniMarkdown('[Go](//evil.example)')
		if (blocks[0].kind !== 'paragraph') throw new Error('expected paragraph')
		expect(blocks[0].children.some((n) => n.kind === 'link')).toBe(false)
	})
})

describe('parseMiniMarkdown — structure', () => {
	test('parses the three heading levels', () => {
		const blocks = parseMiniMarkdown('# One\n\n## Two\n\n### Three')
		expect(blocks.map((b) => (b.kind === 'heading' ? b.level : null))).toEqual([1, 2, 3])
	})

	test('#### is not a heading, because only three levels are supported', () => {
		const blocks = parseMiniMarkdown('#### Four')
		expect(blocks[0].kind).toBe('paragraph')
	})

	test('splits paragraphs on blank lines and joins wrapped lines', () => {
		const blocks = parseMiniMarkdown('first line\nstill first\n\nsecond')
		expect(blocks).toHaveLength(2)
		if (blocks[0].kind === 'paragraph') expect(textOf(blocks[0].children)).toBe('first line still first')
	})

	test('collects consecutive bullets into one list', () => {
		const blocks = parseMiniMarkdown('- one\n- two\n* three')
		expect(blocks).toHaveLength(1)
		expect(blocks[0].kind).toBe('list')
		if (blocks[0].kind === 'list') expect(blocks[0].items.map(textOf)).toEqual(['one', 'two', 'three'])
	})

	test('parses a blockquote', () => {
		const blocks = parseMiniMarkdown('> quoted words')
		expect(blocks[0].kind).toBe('quote')
	})
})

describe('parseMiniMarkdown — inline emphasis', () => {
	test('bold, italic and code', () => {
		const blocks = parseMiniMarkdown('a **bold** and *italic* and `code`')
		if (blocks[0].kind !== 'paragraph') throw new Error('expected paragraph')
		const kinds = blocks[0].children.map((n) => n.kind)
		expect(kinds).toContain('strong')
		expect(kinds).toContain('em')
		expect(kinds).toContain('code')
	})

	test('backticks protect their contents from emphasis parsing', () => {
		const blocks = parseMiniMarkdown('`**not bold**`')
		if (blocks[0].kind !== 'paragraph') throw new Error('expected paragraph')
		const code = blocks[0].children.find((n) => n.kind === 'code')
		expect(code?.kind === 'code' && code.value).toBe('**not bold**')
	})

	test('an unmatched asterisk stays literal instead of swallowing the line', () => {
		const blocks = parseMiniMarkdown('2 * 3 = 6')
		if (blocks[0].kind !== 'paragraph') throw new Error('expected paragraph')
		expect(textOf(blocks[0].children)).toBe('2 * 3 = 6')
	})

	test('does not recurse without bound on nested emphasis', () => {
		const blocks = parseMiniMarkdown(`${'*'.repeat(40)}deep${'*'.repeat(40)}`)
		expect(blocks).toHaveLength(1)
	})
})

describe('parseMiniMarkdown — empty input', () => {
	test('blank and whitespace-only sources produce no blocks', () => {
		expect(parseMiniMarkdown('')).toEqual([])
		expect(parseMiniMarkdown('   \n\n  ')).toEqual([])
	})
})
