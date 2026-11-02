import { describe, expect, test } from 'bun:test'

import { runDemoFridayR20CourierCli } from './demo-friday-r20-courier-cli'

describe('R20 fixed courier CLI contract', () => {
	test('rejects caller-selected paths and unsupported verbs before reading inputs', async () => {
		const profile = { inputRoot: '/tmp/friday-r20-fixed-inputs',
			courier: { root: '/tmp/friday-r20-fixed-courier', expectedUid: 1000, expectedGid: 1000 } }
		await expect(runDemoFridayR20CourierCli(['relay', 'enrollment', '/tmp/other'], profile,
			new TextEncoder().encode('{}'))).rejects.toThrow('usage:')
		await expect(runDemoFridayR20CourierCli(['copy', '/tmp/from', '/tmp/to'], profile)).rejects.toThrow('usage:')
		await expect(runDemoFridayR20CourierCli(['init'], { ...profile, inputRoot: 'relative' }))
			.rejects.toThrow('dedicated canonical absolute path')
	})

	test('rejects root identities for the fixed operator-owned courier', async () => {
		await expect(runDemoFridayR20CourierCli(['init'], { inputRoot: '/tmp/friday-r20-fixed-inputs',
			courier: { root: '/tmp/friday-r20-fixed-courier', expectedUid: 0, expectedGid: 0 } }))
			.rejects.toThrow('expected identity is invalid')
	})
})
