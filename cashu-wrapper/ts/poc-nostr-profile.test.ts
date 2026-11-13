import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { PROFILE_RELAY, readVerifiedNostrProfile, verifiedNostrProfile } from './poc-nostr-profile'

function profileEvent(secret: Uint8Array, content: Record<string, unknown>, createdAt = 10) {
	return finalizeEvent({ kind: 0, created_at: createdAt, tags: [], content: JSON.stringify(content) }, secret)
}

describe('verified Nostr profile presentation', () => {
	test('accepts only the actor exact signed kind-0 event and bounds unverified presentation fields', () => {
		const secret = generateSecretKey(), actor = getPublicKey(secret)
		const event = profileEvent(secret, {
			display_name: `<b>${'n'.repeat(80)}</b>\u202e`,
			name: ' secondary ', about: 'a'.repeat(400),
			picture: 'https://images.example/avatar.png?size=96', nip05: 'self@example.com',
		})
		const profile = verifiedNostrProfile(event, actor)
		expect(profile?.actor).toBe(actor)
		expect([...profile!.displayName].length).toBe(64)
		expect(profile?.displayName).not.toContain('\u202e')
		expect(profile?.displayName.startsWith('<b>')).toBe(true)
		expect(profile?.about.length).toBe(280)
		expect(profile?.picture).toBe('https://images.example/avatar.png?size=96')

		const tamperedActor = JSON.parse(JSON.stringify(event)); tamperedActor.pubkey = 'f'.repeat(64)
		const tamperedKind = JSON.parse(JSON.stringify(event)); tamperedKind.kind = 1
		const tamperedContent = JSON.parse(JSON.stringify(event)); tamperedContent.content = '{}'
		expect(verifiedNostrProfile(tamperedActor, actor)).toBeNull()
		expect(verifiedNostrProfile(tamperedKind, actor)).toBeNull()
		expect(verifiedNostrProfile(tamperedContent, actor)).toBeNull()

		const verifiedThenMutated = profileEvent(secret, { name: 'Before mutation' })
		expect(verifiedNostrProfile(verifiedThenMutated, actor)?.name).toBe('Before mutation')
		verifiedThenMutated.content = JSON.stringify({ name: 'After mutation' })
		expect(verifiedNostrProfile(verifiedThenMutated, actor)).toBeNull()
	})

	test('rejects unsafe images and malformed or oversized metadata', () => {
		const secret = generateSecretKey(), actor = getPublicKey(secret)
		for (const picture of ['http://images.example/a.png', 'data:image/png;base64,abc',
			'https://user:pass@images.example/a.png', 'https://images.example/a.png#fragment']) {
			expect(verifiedNostrProfile(profileEvent(secret, { picture }), actor)?.picture).toBe('')
		}
		expect(verifiedNostrProfile(finalizeEvent({ kind: 0, created_at: 1, tags: [], content: '{' }, secret), actor)).toBeNull()
		expect(verifiedNostrProfile(profileEvent(secret, { name: 'x'.repeat(17_000) }), actor)).toBeNull()
	})

	test('reads the newest verified event through only the pinned relay contract', async () => {
		const secret = generateSecretKey(), actor = getPublicKey(secret)
		const calls: unknown[] = []
		const profile = await readVerifiedNostrProfile(actor, { query: async (requestedActor, signal, timeoutMs) => {
			calls.push({ requestedActor, aborted: signal.aborted, timeoutMs, relay: PROFILE_RELAY })
			return [profileEvent(secret, { name: 'Old' }, 4), profileEvent(secret, { display_name: 'Newest' }, 5)]
		} })
		expect(calls).toEqual([{ requestedActor: actor, aborted: false, timeoutMs: 6_000, relay: 'wss://relay.powr.build/' }])
		expect(profile?.displayName).toBe('Newest')
	})

	test('cancels stale reads instead of returning an identity after disconnect', async () => {
		const secret = generateSecretKey(), actor = getPublicKey(secret), abort = new AbortController()
		let release!: (events: ReturnType<typeof profileEvent>[]) => void
		const pending = readVerifiedNostrProfile(actor, { signal: abort.signal,
			query: async () => new Promise(resolve => { release = resolve }) })
		abort.abort(); release([profileEvent(secret, { name: 'Too late' })])
		await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
	})
})
