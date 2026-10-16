import { NDKUser, type NDKSigner } from '@nostr-dev-kit/ndk'
import { UnsupportedSignerOperationError, type EncryptingSigner, type SignableRumorLike } from '@sdk/core'

/**
 * Adapts a concrete NDK signer into the SDK's `EncryptingSigner` port. This is the
 * Platform-side boundary: the SDK's NIP-17/44/59 logic never imports NDK directly,
 * and this is the one place `NDKUser` gets constructed to satisfy NDK's own
 * `encrypt`/`decrypt` signatures.
 */
export function toEncryptingSigner(signer: NDKSigner): EncryptingSigner {
	return {
		async getPublicKey() {
			const user = await signer.user()
			if (!user?.pubkey) throw new Error('Signer pubkey unavailable')
			return user.pubkey
		},
		async signEvent(event: SignableRumorLike) {
			if (typeof signer.sign !== 'function') {
				throw new UnsupportedSignerOperationError('Signer does not support sign')
			}
			return await signer.sign(event as Parameters<NDKSigner['sign']>[0])
		},
		async encrypt(recipientPubkey: string, plaintext: string) {
			return await signer.encrypt(new NDKUser({ pubkey: recipientPubkey }), plaintext, 'nip44')
		},
		async decrypt(senderPubkey: string, ciphertext: string) {
			return await signer.decrypt(new NDKUser({ pubkey: senderPubkey }), ciphertext, 'nip44')
		},
		async supportsNip44(operation: 'encrypt' | 'decrypt') {
			if (typeof signer.encryptionEnabled !== 'function') return false
			if (operation === 'encrypt' && typeof signer.encrypt !== 'function') return false
			if (operation === 'decrypt' && typeof signer.decrypt !== 'function') return false
			try {
				const enabled = await signer.encryptionEnabled('nip44')
				return enabled.includes('nip44')
			} catch {
				return false
			}
		},
	}
}
