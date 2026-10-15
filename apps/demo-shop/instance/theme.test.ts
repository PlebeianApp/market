/**
 * theme.test.ts — the retheme, held as source facts.
 *
 * The browser pass (`capture-product-list.mjs`, plus the computed-style readout
 * in the increment's report) is what proves the sheet *applies*. This file holds
 * the properties a later edit would quietly undo, because a palette is a token
 * layer and one hard-coded value defeats it: **a re-skin means replacing the
 * tokens and then proving nothing else still carries the old colours.**
 *
 * Five arms, each with the mutation that turns it red:
 * - **the adopted values are present.** Mutation: change `--ds-bg` back to the
 *   dark ground this revision replaced — the presence arm names it.
 * - **the old dark palette is gone from every file the app owns.** Mutation:
 *   re-introduce the old pink as `--ds-accent`'s value — the sweep names the file.
 *   (The sweep reads this file too, which is why the needles are assembled from
 *   hex bodies at run time and never written out here.)
 * - **corners are square.** Mutation: write `border-radius: 0.6rem` on `.ds-row`
 *   — the corner arm fails and names the value.
 * - **every margin, padding and gap is a whole multiple of the one unit.**
 *   Mutation: write `gap: 1.5rem` on `.ds-main` — 1.5rem is not `var(--ds-u)`.
 * - **every region is a landmark, and the skeleton state exists.** Mutation:
 *   drop `aria-label` from the `region-products` section, or delete the
 *   `data-skeleton="1"` count placeholder — each fails on its own arm.
 *
 * WHY THE `region` ARM MATCHES ON THE WHOLE TAG. A region is the landmark a
 * reader addresses, so "the element that carries `region-region-x` also carries
 * an `aria-label`" is the fact being checked; it is read out of the JSX opening
 * tag rather than from a rendered page, because rendering the page needs a
 * server and ADR-0005 keeps a test off the wire. The browser pass covers the
 * rendered form.
 */

import { describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const APP_ROOT = resolve(import.meta.dir, '..')
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.css'])
const SKIP_DIRECTORIES = new Set(['node_modules', '.capture', 'dist'])

/** The tokens the house style is defined by, and the values this app adopted. */
const ADOPTED: Record<string, string> = {
	'--ds-bg': '#fbf8f5',
	'--ds-surface': '#f1ece6',
	'--ds-surface-2': '#f6f1ea',
	'--ds-surface-3': '#ece6de',
	'--ds-fg': '#141414',
	'--ds-muted': '#6b645d',
	'--ds-border': '#e6dfd7',
	'--ds-border-strong': '#d6cdc2',
	'--ds-accent': '#141414',
	'--ds-accent-2': '#ff4fa3',
	'--ds-accent-ink': '#ffffff',
	'--ds-accent-soft': '#ffe9f3',
	'--ds-accent-2-soft': '#ffeaf4',
	'--ds-success': '#1e7f4f',
	'--ds-success-soft': '#e8f4ee',
	'--ds-warn': '#a8620a',
	'--ds-warn-soft': '#fbf1e2',
	'--ds-danger': '#c0332b',
	'--ds-danger-soft': '#fbeceb',
	'--ds-u': '1.31rem',
	'--ds-r': '0px',
}

/**
 * The palette this revision replaced. Written as bare hex bodies so that this
 * file does not itself contain the strings it sweeps for — a needle that appears
 * in the haystack's own source is the way this kind of gate goes blind.
 */
const REPLACED_PALETTE = ['0b0b0d', 'f4f4f6', '9a9aa6', '26262d', '141418', 'd84a8a'].map((body) => `#${body}`)

async function listFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true })
	const nested = await Promise.all(
		entries.map(async (entry) => {
			if (SKIP_DIRECTORIES.has(entry.name)) return []
			const fullPath = join(directory, entry.name)
			if (entry.isDirectory()) return listFiles(fullPath)
			return SOURCE_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf('.'))) ? [fullPath] : []
		}),
	)
	return nested.flat()
}

async function readAppFiles(): Promise<{ path: string; source: string }[]> {
	const files = await listFiles(APP_ROOT)
	return Promise.all(files.map(async (path) => ({ path, source: await readFile(path, 'utf8') })))
}

const sheet = await readFile(join(APP_ROOT, 'styles.css'), 'utf8')

/** The `:root` block's custom properties, as declared. */
function rootTokens(css: string): Map<string, string> {
	const start = css.indexOf(':root')
	const open = css.indexOf('{', start)
	const close = css.indexOf('}', open)
	const block = css.slice(open + 1, close)
	const tokens = new Map<string, string>()
	for (const line of block.split('\n')) {
		const match = /^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/.exec(line)
		if (match?.[1] && match[2]) tokens.set(match[1], match[2].trim())
	}
	return tokens
}

/** Every `property: value` declaration in the sheet, for the arms that scan values. */
function declarations(css: string): { property: string; value: string }[] {
	const found: { property: string; value: string }[] = []
	for (const match of css.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)[;}]/g)) {
		if (match[1] && match[2]) found.push({ property: match[1], value: match[2].trim() })
	}
	return found
}

describe('the retheme adopts the house style tokens', () => {
	test('every adopted token is declared at the value the style source measured', () => {
		const tokens = rootTokens(sheet)

		for (const [name, value] of Object.entries(ADOPTED)) {
			expect(`${name}: ${tokens.get(name)}`).toBe(`${name}: ${value}`)
		}
	})

	test('the app carries no value from the palette this revision replaced', async () => {
		const violations: string[] = []

		for (const { path, source } of await readAppFiles()) {
			// Prose is stripped before the sweep: this sheet's own header *names*
			// the ground it replaced, and a comment is not a value in use. What is
			// being swept is what the sheet applies.
			const applied = source.replace(/\/\*[\s\S]*?\*\//g, '')
			for (const hex of REPLACED_PALETTE) {
				if (applied.toLowerCase().includes(hex)) {
					violations.push(`${path.slice(APP_ROOT.length + 1)} still carries ${hex}`)
				}
			}
		}

		expect(violations).toEqual([])
	})

	test('no remote asset is referenced — the sheet is self-contained', () => {
		expect(sheet.match(/https?:\/\//g) ?? []).toEqual([])
	})
})

describe('the layout conventions the style source keeps', () => {
	test('corners are square: every radius is the one token, and it is 0', () => {
		const radii = declarations(sheet)
			.filter(({ property }) => property === 'border-radius')
			.map(({ value }) => value)
		const nonToken = radii.filter((value) => value !== 'var(--ds-r)' && value !== '0')

		expect(radii.length).toBeGreaterThan(0)
		expect(nonToken).toEqual([])
		expect(rootTokens(sheet).get('--ds-r')).toBe('0px')
	})

	test('every margin, padding and gap is a whole multiple of the one spacing unit', () => {
		const SPACING = /^(margin|padding|gap)(-(top|right|bottom|left|block|inline))?$/
		const STEP_TOKEN = /var\(--ds-[1-7]\)/g
		const violations: string[] = []

		for (const { property, value } of declarations(sheet)) {
			if (!SPACING.test(property)) continue
			// A step token is a declared multiple of --ds-u by construction; what
			// is left after removing them must be nothing but zeroes.
			const remainder = value.replace(STEP_TOKEN, ' ').trim()
			for (const part of remainder.split(/\s+/).filter((piece) => piece.length > 0)) {
				if (part !== '0' && part !== 'auto') violations.push(`${property}: ${value}`)
			}
		}

		expect(violations).toEqual([])
	})

	test('the spacing steps are declared as multiples of the unit', () => {
		const tokens = rootTokens(sheet)
		const steps = [...tokens.entries()].filter(([name]) => /^--ds-[1-7]$/.test(name))

		expect(steps).toHaveLength(7)
		for (const [name, value] of steps) {
			expect(`${name}: ${value}`).toContain('var(--ds-u)')
		}
	})

	test('every region is a landmark: the class and its aria-label are on one tag', async () => {
		const violations: string[] = []
		const seen = new Set<string>()

		for (const { path, source } of await readAppFiles()) {
			if (!path.endsWith('.tsx')) continue
			for (const match of source.matchAll(/<[A-Za-z][^>]*region region-[a-z-]+[^>]*>/g)) {
				const tag = match[0]
				for (const name of tag.match(/region region-[a-z-]+/g) ?? []) seen.add(name.replace('region ', ''))
				if (!/aria-label=/.test(tag)) violations.push(`${path.slice(APP_ROOT.length + 1)}: ${tag.slice(0, 72)}`)
			}
		}

		expect(violations).toEqual([])
		expect([...seen].sort()).toEqual([
			'region-foot',
			'region-instance',
			'region-nav',
			'region-product',
			'region-products',
		])
	})

	test('the skeleton state exists, and is the cart count the server cannot know', async () => {
		const app = await readFile(join(APP_ROOT, 'instance', 'App.tsx'), 'utf8')

		expect(app).toContain('data-skeleton="1"')
		expect(sheet).toMatch(/\.sk\s*\{[^}]*animation:/)
		expect(sheet).toMatch(/\.sk-line\s*\{/)
	})
})

describe('the sheet stands on its own', () => {
	test('it imports nothing and fetches nothing', () => {
		// The sheet names where its style came from in prose; what it must not do
		// is *reach* for it — no @import, no url(), no remote font host.
		expect(sheet).not.toContain('@import')
		expect(sheet).not.toContain('url(')
		expect(sheet).not.toContain('@font-face')
	})
})
