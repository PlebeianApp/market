/**
 * The module's own suite: the binding exists, the id is what a token was minted with, and a token carries
 * its name for a refusal's wording. The phantom marker is a type-level property and is deliberately not
 * asserted here — `index.test-d.ts`-style checking is what would catch it, and the typechecker is the
 * oracle for it.
 */
import { describe, expect, test } from 'bun:test'
import { capabilityId, capabilityToken, type CapabilityToken } from './index'

interface Counter {
	increment(by: number): number
}

describe('capabilityToken / capabilityId — the single binding point', () => {
	test('a minted token carries the id it was minted with', () => {
		const token = capabilityToken<Counter>('counter', 'the counter')
		expect(capabilityId(token)).toBe('counter')
	})

	test('a token carries its human name, for a refusal to word itself', () => {
		const token = capabilityToken<Counter>('counter', 'the counter')
		expect(token.name).toBe('the counter')
	})

	test('the token is a value with exactly id and name — the phantom marker is never present', () => {
		const token = capabilityToken<Counter>('counter', 'the counter')
		expect(Object.keys(token).sort()).toEqual(['id', 'name'])
		expect(Object.hasOwn(token, '__capability')).toBe(false)
	})

	test('two tokens minted for the same id are equal by id and distinct as values', () => {
		const a = capabilityToken<Counter>('counter', 'the counter')
		const b = capabilityToken<Counter>('counter', 'the counter again')
		expect(capabilityId(a)).toBe(capabilityId(b))
		expect(a).not.toBe(b)
		expect(a.name).not.toBe(b.name)
	})

	test('an id is an open string — the module states no rule about its shape', () => {
		const token: CapabilityToken<Counter> = capabilityToken('anything:goes', 'a name')
		expect(capabilityId(token)).toBe('anything:goes')
	})
})
