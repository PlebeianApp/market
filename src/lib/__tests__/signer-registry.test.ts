/**
 * Signer registry tests.
 *
 * The registry is the single sanctioned home for `applesauce-signers` imports
 * and holds the currently-attached signer capability (module state). The key
 * invariant under test: the attached capability must always track the NDK
 * signer — a signer removed by ANY path (not just `authActions.logout`) must
 * also clear the registry, or `io-applesauce.sign()` would keep signing with a
 * stale key.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { generateSecretKey } from 'nostr-tools'
import { bytesToHex } from 'nostr-tools/utils'

import { createPrivateKeySigner, getSignerCapability, setSignerCapability } from '@/lib/nostr/signer-registry'
import { ndkActions, ndkStore } from '@/lib/stores/ndk'

describe('signer registry', () => {
	beforeEach(() => {
		setSignerCapability(undefined)
	})

	afterEach(() => {
		setSignerCapability(undefined)
		// Restore the store to its initial (uninitialized) state.
		ndkStore.setState((s) => ({ ...s, ndk: null, signer: undefined }))
	})

	test('set/get round-trips the attached capability and clears on undefined', () => {
		const capability = createPrivateKeySigner(bytesToHex(generateSecretKey()))

		expect(getSignerCapability()).toBeUndefined()
		setSignerCapability(capability)
		expect(getSignerCapability()).toBe(capability)
		setSignerCapability(undefined)
		expect(getSignerCapability()).toBeUndefined()
	})

	test('a non-logout removeSigner path clears the attached capability too', () => {
		const capability = createPrivateKeySigner(bytesToHex(generateSecretKey()))
		setSignerCapability(capability)
		expect(getSignerCapability()).toBe(capability)

		// Make the NDK store look initialized so setSigner(undefined) takes the
		// non-initializing branch (no NDK graph / relay side effects).
		ndkStore.setState((s) => ({ ...s, ndk: {} as never }))

		// Remove the signer without going through authActions.logout.
		ndkActions.removeSigner()

		expect(getSignerCapability()).toBeUndefined()
	})
})
