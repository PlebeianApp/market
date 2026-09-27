/**
 * The token floor is encoded twice — `TOKEN_FLOOR` in TypeScript and `tokens.css` for the cascade — and
 * two encodings are only acceptable when they are machine-readable **and** a check fails the pair when
 * they disagree. This is that check.
 *
 * It exists because the maintainer's rule for two mirrored sources is explicit (2026-09-22): mirroring is
 * fine, silent disagreement is not. Without this test the pair is a promise; with it, it is a contract.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { TOKEN_FLOOR } from '../index'

const css = readFileSync(new URL('../tokens.css', import.meta.url), 'utf8')
const cssTokens = Object.fromEntries(
	[...css.matchAll(/--pb-([a-z0-9-]+):\s*([^;]+);/g)].map((match) => [match[1] as string, (match[2] as string).trim()]),
)

describe('TOKEN_FLOOR and tokens.css must agree', () => {
	test('the check itself is real: it found the tokens', () => {
		expect(Object.keys(cssTokens).length).toBeGreaterThan(0)
		expect(Object.keys(TOKEN_FLOOR).length).toBeGreaterThan(0)
	})

	test('every token in TOKEN_FLOOR is in tokens.css with the same value', () => {
		for (const [name, value] of Object.entries(TOKEN_FLOOR)) {
			expect(cssTokens[name], `--pb-${name} is missing from tokens.css`).toBeDefined()
			expect(cssTokens[name], `--pb-${name} disagrees between TOKEN_FLOOR and tokens.css`).toBe(value)
		}
	})

	test('tokens.css defines nothing the contract does not know about', () => {
		// The reverse direction matters too: a value only in CSS is a value no implementation can see.
		expect(Object.keys(cssTokens).sort()).toEqual(Object.keys(TOKEN_FLOOR).sort())
	})
})
