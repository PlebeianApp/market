/**
 * Payout key material for the auction validator.
 *
 * A validator that verifies auctions also takes a fee, and a fee is only worth taking if it can
 * be redeemed. That needs key material the validator controls:
 *
 *   master payout seed (private, never published)
 *     └─ HD master ─┬─ publicExtendedKey  → published per mint in the kind-1027 capability
 *                   │                        (with the whole-xpub proof of possession, D3)
 *                   └─ master private key  → signs that proof of possession
 *
 *   child_pubkey = derive(payout_xpub, shared_path)   ← what each leg is locked to (D8)
 *
 * The operator handles the SEED only. The xpub is derived and published; the operator-facing
 * artefact is a FINGERPRINT, so they can check that the key receiving funds is the key they
 * hold.
 *
 * Three checks, all fail-loud, because the third is the one that looks healthy:
 *
 * 1. no seed configured        → `payout_seed_missing`
 * 2. seed malformed            → `payout_seed_malformed`
 * 3. seed does not reproduce the xpub already announced → `payout_xpub_changed`, overridable
 *    only deliberately with `CVM_ALLOW_PAYOUT_KEY_CHANGE=1`
 *
 * Check 3 exists because a validator that silently announces a new xpub while funds remain
 * locked under the old one looks perfectly healthy and strands those funds. Rotation is
 * additive (publish the new xpub, keep the old seed until nothing is locked under it); see
 * `docs/protocol/auction-multiparty-settlement-v1.md` §4.
 */

import { HDKey } from '@scure/bip32'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

/** The one variable both provisioning paths use (CI secret, or the operator's own `.env`). */
export const PAYOUT_SEED_ENV = 'CVM_PAYOUT_SEED'

/** Deliberate override for a changed payout key. Without it, a mismatch refuses to start. */
export const PAYOUT_KEY_CHANGE_OVERRIDE_ENV = 'CVM_ALLOW_PAYOUT_KEY_CHANGE'

/** The generator script the error messages point at. */
export const PAYOUT_SEED_GENERATOR = 'bun run scripts/generate-validator-payout-seed.ts'

const SEED_HEX = /^[0-9a-f]{64}$/i

export type PayoutKeyProblemCode = 'payout_seed_missing' | 'payout_seed_malformed' | 'payout_xpub_changed'

export interface PayoutKeyMaterial {
	/** The BIP32 master, from the seed. Never log this. */
	readonly master: HDKey
	/** What gets published in the capability. */
	readonly xpub: string
	/** Short, stable, human-comparable digest of the xpub. Not a security boundary. */
	readonly fingerprint: string
}

export type ResolvedPayoutKey =
	| { readonly ok: true; readonly material: PayoutKeyMaterial; readonly changed: boolean }
	| { readonly ok: false; readonly code: PayoutKeyProblemCode; readonly message: string }

/**
 * A 32-byte seed from its hex form.
 *
 * Any 32 bytes are a valid BIP32 seed — there is no scalar check to make here, only a length and
 * alphabet check, so a truncated or copy-pasted-with-quotes value fails loudly instead of
 * silently deriving a different wallet.
 */
export const parsePayoutSeed = (value: string): Uint8Array => {
	const trimmed = value.trim()
	if (!SEED_HEX.test(trimmed)) {
		throw new Error(
			`${PAYOUT_SEED_ENV} must be 64 hex characters (32 bytes); got ${trimmed.length} character(s). ` +
				'Generate one with the payout seed script rather than typing it by hand.',
		)
	}
	return hexToBytes(trimmed.toLowerCase())
}

/** Derive the publishable xpub and its fingerprint from a seed. */
export const derivePayoutKeyMaterial = (seed: Uint8Array): PayoutKeyMaterial => {
	const master = HDKey.fromMasterSeed(seed)
	if (!master.publicExtendedKey) {
		throw new Error('Failed to derive a payout xpub from the configured seed')
	}
	return {
		master,
		xpub: master.publicExtendedKey,
		fingerprint: payoutKeyFingerprint(master.publicExtendedKey),
	}
}

/**
 * A short digest of the xpub, for an operator to compare against what the app shows.
 *
 * Deliberately a digest and not a checksum: it answers "is this the same key?" and nothing else.
 */
export const payoutKeyFingerprint = (xpub: string): string => bytesToHex(sha256(new TextEncoder().encode(xpub))).slice(0, 16)

/**
 * Resolve the configured payout key, or say precisely why it cannot be used.
 *
 * `announcedXpub` is the xpub this validator has already published (read back from its own
 * latest kind-1027 capability, the same read-your-own-history pattern as
 * `observedAtRecovery.ts`). Pass `undefined` when there is nothing announced yet — a first run
 * has nothing to contradict.
 */
export const resolvePayoutKey = (input: {
	readonly env: Record<string, string | undefined>
	readonly announcedXpub?: string
}): ResolvedPayoutKey => {
	const raw = input.env[PAYOUT_SEED_ENV]
	if (raw === undefined || raw.trim().length === 0) {
		return {
			ok: false,
			code: 'payout_seed_missing',
			message:
				`${PAYOUT_SEED_ENV} is not configured, so this validator cannot be paid and must not announce a ` +
				'payout capability. Configure it one of two ways: on a CI-deployed instance, add it as a ' +
				`repository/environment secret (CI rewrites .env on every deploy, so a value written on the host ` +
				`does not survive); self-hosting, put it in your own .env. Generate one with: ${PAYOUT_SEED_GENERATOR}`,
		}
	}

	let seed: Uint8Array
	try {
		seed = parsePayoutSeed(raw)
	} catch (err) {
		return { ok: false, code: 'payout_seed_malformed', message: err instanceof Error ? err.message : String(err) }
	}

	const material = derivePayoutKeyMaterial(seed)

	if (input.announcedXpub && input.announcedXpub !== material.xpub) {
		const override = (input.env[PAYOUT_KEY_CHANGE_OVERRIDE_ENV] ?? '').trim()
		const overridden = override === '1' || override.toLowerCase() === 'true'
		if (!overridden) {
			return {
				ok: false,
				code: 'payout_xpub_changed',
				message:
					'The configured payout seed does not reproduce the xpub this validator has already announced. ' +
					'Starting now would publish a new xpub while funds remain locked to the old one, which strands them. ' +
					`Announced: ${input.announcedXpub} (fingerprint ${payoutKeyFingerprint(input.announcedXpub)}). ` +
					`Configured: ${material.xpub} (fingerprint ${material.fingerprint}). ` +
					'Restore the seed that produced the announced xpub, or — if the change is intended and the old ' +
					`funds are accounted for — set ${PAYOUT_KEY_CHANGE_OVERRIDE_ENV}=1 and keep the old seed until ` +
					'nothing remains locked under the old xpub.',
			}
		}
		return { ok: true, material, changed: true }
	}

	return { ok: true, material, changed: false }
}

/** Whether a seed is already present, for the generator's refuse-to-overwrite rule. */
export const hasConfiguredPayoutSeed = (env: Record<string, string | undefined>): boolean => (env[PAYOUT_SEED_ENV] ?? '').trim().length > 0
