import { describe, expect, test } from 'bun:test'

import { BLOSSOM_SERVERS } from '@/lib/blossom'

describe('BLOSSOM_SERVERS', () => {
	test('includes the Orangesync public server', () => {
		const orangesync = BLOSSOM_SERVERS.find((s) => s.name === 'Orangesync')
		expect(orangesync).toBeDefined()
		expect(orangesync!.url).toBe('https://blossom2.orangesync.tech')
		expect(orangesync!.plan).toBe('public')
	})

	test('every server has a non-empty name, http(s) url, and valid plan', () => {
		expect(BLOSSOM_SERVERS.length).toBeGreaterThan(0)
		for (const s of BLOSSOM_SERVERS) {
			expect(s.name).toBeTruthy()
			expect(s.url).toMatch(/^https?:\/\//)
			expect(['free', 'paid', 'public']).toContain(s.plan)
		}
	})

	test('at least one public server is available as a fallback', () => {
		const publicServers = BLOSSOM_SERVERS.filter((s) => s.plan === 'public')
		expect(publicServers.length).toBeGreaterThanOrEqual(1)
	})
})
