/** The minimal shape nip59.ts needs to sign a rumor/seal and NIP-44 encrypt/decrypt for a peer. */
export interface SignableRumorLike {
	kind: number
	content: string
	created_at: number
	tags: string[][]
	pubkey: string
}

/**
 * A host-supplied signing + NIP-44 encryption capability, expressed without any
 * reference to a concrete signer library (NDK's `NDKSigner`/`NDKUser` included).
 * Platform adapts a real signer (e.g. NDK) into this shape at the boundary —
 * notably, `encrypt`/`decrypt` take plain pubkey strings, never a library's own
 * user/recipient class.
 */
export interface EncryptingSigner {
	getPublicKey(): Promise<string>
	/** Returns the raw signature, mirroring how signers return a signature rather than a full event. */
	signEvent(event: SignableRumorLike): Promise<string>
	encrypt(recipientPubkey: string, plaintext: string): Promise<string>
	decrypt(senderPubkey: string, ciphertext: string): Promise<string>
	supportsNip44(operation: 'encrypt' | 'decrypt'): Promise<boolean>
}

/**
 * Thrown by an `EncryptingSigner` adapter when the underlying concrete signer
 * (e.g. a real NDK signer) lacks the capability entirely — distinct from the
 * operation being attempted and failing. Callers use this to surface a specific
 * "not supported" message rather than a generic failure.
 */
export class UnsupportedSignerOperationError extends Error {}
