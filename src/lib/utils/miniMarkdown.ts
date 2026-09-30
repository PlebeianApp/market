import { isSafeHref } from '@/lib/schemas/storefront'

/**
 * A deliberately tiny markdown subset for storefront text blocks.
 *
 * This is not a markdown implementation and should not grow into one. It exists
 * so authors can write prose with light emphasis while the renderer keeps its
 * "no raw HTML" guarantee (see `src/lib/schemas/storefront.ts`): the parser
 * emits a *token tree*, and the React renderer turns tokens into elements. No
 * string ever reaches `dangerouslySetInnerHTML`, so an author who types
 * `<script>` gets the literal characters on screen.
 *
 * Supported: `#`/`##`/`###` headings, blank-line-separated paragraphs, `-`/`*`
 * bullet lists, `>` quotes, and inline `**bold**`, `*italic*`, `` `code` ``,
 * `[label](https://...)`.
 *
 * Anything else — tables, images, HTML, reference links, setext headings — is
 * left as literal text. Unmatched delimiters are literal text too, so a lone
 * asterisk renders as an asterisk instead of swallowing the rest of the block.
 */

export type MiniMarkdownInline =
	| { kind: 'text'; value: string }
	| { kind: 'strong'; children: MiniMarkdownInline[] }
	| { kind: 'em'; children: MiniMarkdownInline[] }
	| { kind: 'code'; value: string }
	| { kind: 'link'; href: string; children: MiniMarkdownInline[] }

export type MiniMarkdownBlock =
	| { kind: 'heading'; level: 1 | 2 | 3; children: MiniMarkdownInline[] }
	| { kind: 'paragraph'; children: MiniMarkdownInline[] }
	| { kind: 'list'; items: MiniMarkdownInline[][] }
	| { kind: 'quote'; children: MiniMarkdownInline[] }

/** Guards against a pathological document costing unbounded parse time. */
const MAX_INLINE_DEPTH = 4

interface InlineRule {
	pattern: RegExp
	build: (match: RegExpExecArray, depth: number) => MiniMarkdownInline | null
}

/**
 * Order is significant. Code spans come first so backticks protect their
 * contents; links before emphasis so a `*` inside a URL is not read as italics;
 * `**` before `*` so bold is not parsed as two empty italics.
 */
const INLINE_RULES: InlineRule[] = [
	{
		pattern: /`([^`\n]+)`/,
		build: (m) => ({ kind: 'code', value: m[1] }),
	},
	{
		pattern: /\[([^\]\n]*)\]\(([^)\s]+)\)/,
		build: (m, depth) => {
			const [, label, href] = m
			const children = parseInline(label, depth + 1)
			// An unsafe href degrades to plain text rather than disappearing: the
			// author's words survive, only the navigation is refused.
			if (!isSafeHref(href)) {
				return children.length > 0 ? { kind: 'em', children } : null
			}
			return { kind: 'link', href, children: children.length > 0 ? children : [{ kind: 'text', value: href }] }
		},
	},
	{
		pattern: /\*\*([^\n]+?)\*\*/,
		build: (m, depth) => ({ kind: 'strong', children: parseInline(m[1], depth + 1) }),
	},
	{
		pattern: /\*([^*\n]+?)\*/,
		build: (m, depth) => ({ kind: 'em', children: parseInline(m[1], depth + 1) }),
	},
	{
		pattern: /_([^_\n]+?)_/,
		build: (m, depth) => ({ kind: 'em', children: parseInline(m[1], depth + 1) }),
	},
]

function pushText(out: MiniMarkdownInline[], value: string): void {
	if (value.length === 0) return
	const last = out[out.length - 1]
	if (last && last.kind === 'text') {
		last.value += value
		return
	}
	out.push({ kind: 'text', value })
}

/**
 * Scans left to right, always taking the *earliest* match among the rules, so
 * `a **b** c` and `a \`b\` c` behave the same way regardless of rule order in
 * the list. Text before a match is emitted verbatim.
 */
function parseInline(source: string, depth = 0): MiniMarkdownInline[] {
	const out: MiniMarkdownInline[] = []
	if (source.length === 0) return out
	if (depth >= MAX_INLINE_DEPTH) {
		pushText(out, source)
		return out
	}

	let rest = source

	while (rest.length > 0) {
		let bestIndex = -1
		let bestMatch: RegExpExecArray | null = null
		let bestRule: InlineRule | null = null

		for (const rule of INLINE_RULES) {
			const match = rule.pattern.exec(rest)
			if (!match) continue
			if (bestIndex === -1 || match.index < bestIndex) {
				bestIndex = match.index
				bestMatch = match
				bestRule = rule
			}
		}

		if (!bestMatch || !bestRule || bestIndex === -1) {
			pushText(out, rest)
			break
		}

		pushText(out, rest.slice(0, bestIndex))
		const node = bestRule.build(bestMatch, depth)
		if (node) {
			out.push(node)
		} else {
			// The rule matched but produced nothing renderable (e.g. an empty
			// link label with an unsafe href) — keep the source text so the
			// author can see what they wrote.
			pushText(out, bestMatch[0])
		}
		rest = rest.slice(bestIndex + bestMatch[0].length)
	}

	return out
}

const HEADING = /^(#{1,3})\s+(.*)$/
const BULLET = /^[-*]\s+(.*)$/
const QUOTE = /^>\s?(.*)$/

/**
 * Splits a document into blocks. Line-oriented: a blank line ends the current
 * paragraph, list, or quote.
 */
export function parseMiniMarkdown(source: string): MiniMarkdownBlock[] {
	if (typeof source !== 'string' || source.trim().length === 0) return []

	const blocks: MiniMarkdownBlock[] = []
	const lines = source.replace(/\r\n?/g, '\n').split('\n')

	let paragraph: string[] = []
	let listItems: string[] = []
	let quote: string[] = []

	const flushParagraph = () => {
		if (paragraph.length === 0) return
		const children = parseInline(paragraph.join(' ').trim())
		if (children.length > 0) blocks.push({ kind: 'paragraph', children })
		paragraph = []
	}

	const flushList = () => {
		if (listItems.length === 0) return
		blocks.push({ kind: 'list', items: listItems.map((item) => parseInline(item.trim())) })
		listItems = []
	}

	const flushQuote = () => {
		if (quote.length === 0) return
		const children = parseInline(quote.join(' ').trim())
		if (children.length > 0) blocks.push({ kind: 'quote', children })
		quote = []
	}

	const flushAll = () => {
		flushParagraph()
		flushList()
		flushQuote()
	}

	for (const rawLine of lines) {
		const line = rawLine.trimEnd()

		if (line.trim().length === 0) {
			flushAll()
			continue
		}

		const heading = HEADING.exec(line)
		if (heading) {
			flushAll()
			const level = heading[1].length as 1 | 2 | 3
			const children = parseInline(heading[2].trim())
			if (children.length > 0) blocks.push({ kind: 'heading', level, children })
			continue
		}

		const bullet = BULLET.exec(line)
		if (bullet) {
			flushParagraph()
			flushQuote()
			listItems.push(bullet[1])
			continue
		}

		const quoted = QUOTE.exec(line)
		if (quoted) {
			flushParagraph()
			flushList()
			quote.push(quoted[1])
			continue
		}

		// A plain line continues whichever multi-line construct is open, so a
		// wrapped bullet or quote does not silently become its own paragraph.
		if (listItems.length > 0) {
			listItems[listItems.length - 1] += ` ${line.trim()}`
			continue
		}
		if (quote.length > 0) {
			quote.push(line.trim())
			continue
		}

		paragraph.push(line.trim())
	}

	flushAll()
	return blocks
}
