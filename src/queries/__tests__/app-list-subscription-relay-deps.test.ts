import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

/**
 * Regression guard for the ADR-0002 wave-1 live subscriptions.
 *
 * `useAdminSettings` / `useEditorSettings` / `useBlacklistSettings` only
 * subscribe once the app's main relay is known. If the relay is resolved
 * *inside* the effect body and the value does not appear in the dependency
 * array, a hook that mounts before the relay is known never subscribes at all:
 * React only re-runs an effect when its dependencies change. The pinned-relay
 * discipline is then silently absent for the rest of the session.
 *
 * Master keeps `mainRelay` at hook scope and in the dependency array; the
 * wave-1 rewrite of these files must keep that property. See the ADR-0002
 * "Wave 1 addendum" (F5) for the invariant this encodes.
 */

const FILES = ['app-settings.tsx', 'blacklist.tsx']

interface EffectBlock {
	deps: string
	body: string
}

/** Split a source file into `useEffect(() => { ... }, [deps])` blocks. */
function effectBlocks(source: string): EffectBlock[] {
	const starts = [...source.matchAll(/useEffect\(\(\) => \{/g)].map((match) => match.index ?? 0)
	const blocks: EffectBlock[] = []

	for (const end of source.matchAll(/\}, \[([^\]]*)\]\)/g)) {
		const endIndex = end.index ?? 0
		const startIndex = starts.filter((index) => index < endIndex).pop()
		if (startIndex === undefined) continue
		blocks.push({ deps: end[1], body: source.slice(startIndex, endIndex) })
	}

	return blocks
}

describe('app-list live subscriptions pin to the main relay', () => {
	for (const file of FILES) {
		const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

		test(`${file} contains the subscription effects this guard protects`, () => {
			const subscription = effectBlocks(source).filter((block) => block.body.includes('applesauceIo.subscribe'))
			expect(subscription.length).toBeGreaterThan(0)
		})

		test(`${file} resolves the main relay at hook scope, not inside the effect`, () => {
			for (const block of effectBlocks(source)) {
				if (!block.body.includes('applesauceIo.subscribe')) continue
				expect(block.body).not.toContain('getMainRelay()')
			}
		})

		test(`${file} keeps the main relay in the subscription dependency array`, () => {
			for (const block of effectBlocks(source)) {
				if (!block.body.includes('applesauceIo.subscribe')) continue
				expect(block.deps).toContain('mainRelay')
			}
		})
	}
})
