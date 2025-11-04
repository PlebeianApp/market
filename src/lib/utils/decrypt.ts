import type { NDKEvent } from '@nostr-dev-kit/ndk'
import type { NDKSigner } from '@nostr-dev-kit/ndk'

/**
 * Safe decrypt wrapper that handles NDK initialization errors
 * This prevents "Cannot access 's' before initialization" errors
 * that occur due to race conditions in NDK's bundled code
 */
export async function safeDecryptEvent(
	event: NDKEvent,
	signer: NDKSigner | undefined,
	userPubkey?: string,
): Promise<boolean> {
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
		return true
	} catch (error) {
		// Suppress the specific "Cannot access 's' before initialization" error
		// This is a known NDK race condition bug in bundled code
		if (
			error instanceof ReferenceError &&
			error.message.includes("Cannot access 's' before initialization")
		) {
			console.warn('[NDK] Suppressed decrypt initialization error (race condition)')
			return false
		}

		// For other decryption errors, log but don't throw
		// The content might already be decrypted or encrypted with a different key
		if (error instanceof Error && error.message.includes('decrypt')) {
			console.warn('[NDK] Decryption failed (content may already be decrypted):', error.message)
			return false
		}

		// Re-throw unexpected errors
		throw error
	}
}


