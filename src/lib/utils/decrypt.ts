import type { NDKEvent } from '@nostr-dev-kit/ndk'
import type { NDKSigner } from '@nostr-dev-kit/ndk'

/**
 * Safe decrypt wrapper that handles NDK initialization errors
 * This prevents "Cannot access 's' before initialization" errors
 * that occur due to race conditions in NDK's bundled code
 */
export async function safeDecryptEvent(event: NDKEvent, signer: NDKSigner | undefined, userPubkey?: string): Promise<boolean> {
	if (!signer || !event.content) {
		return false
	}

	// Skip if content doesn't look encrypted
	if (event.content.trim().startsWith('{') || event.content.trim().startsWith('[')) {
		return false
	}

	try {
		// Try NDK's decrypt method with error handling
		await event.decrypt(undefined, signer)

		// Note: We don't save decrypted events to IndexedDB because:
		// 1. NDK's cache stores raw encrypted events from relays
		// 2. Decryption must happen at runtime using private keys
		// 3. Storing decrypted private messages would be a security risk
		// The decryption is fast enough to do on each page load

		return true
	} catch (error) {
		// Suppress the specific "Cannot access 's' before initialization" error
		// This is a known NDK race condition bug in bundled code
		if (error instanceof ReferenceError && error.message.includes("Cannot access 's' before initialization")) {
			return false
		}

		// Suppress "invalid payload length" errors from NIP-44 decryption
		// These occur when content isn't NIP-44 encrypted (might be plain text, NIP-04, or already decrypted)
		if (error instanceof Error && error.message.includes('invalid payload length')) {
			// Content is not NIP-44 encrypted, skip silently
			return false
		}

		// For other decryption errors, silently return false
		// The content might already be decrypted or encrypted with a different key
		if (error instanceof Error && error.message.includes('decrypt')) {
			return false
		}

		// Re-throw unexpected errors
		throw error
	}
}
