/**
 * AuctionWhitelistManager — controls which pubkeys are allowed to publish
 * kind-30408 auction events.
 *
 * Two modes:
 *   - 'open'      → any pubkey may publish (backward-compatible default)
 *   - 'whitelist' → only pubkeys in the whitelist set may publish
 *
 * The manager is configured at startup from environment variables:
 *   APP_AUCTION_WHITELIST_MODE       ('whitelist' | 'open', default 'open')
 *   APP_AUCTION_WHITELIST_PUBKEYS    (comma-separated hex pubkeys, optional)
 *
 * Follows the pattern of AdminManager / EditorManager: a simple in-memory
 * Set<string> with add/isWhitelisted/getWhitelist accessors.
 */

export type AuctionWhitelistMode = 'whitelist' | 'open'

export class AuctionWhitelistManager {
	private mode: AuctionWhitelistMode
	private whitelistedPubkeys: Set<string> = new Set()

	constructor(mode: AuctionWhitelistMode = 'open', initialPubkeys: string[] = []) {
		this.mode = mode
		this.whitelistedPubkeys = new Set(initialPubkeys)
	}

	/** Returns true when whitelist enforcement is active. */
	public isWhitelistMode(): boolean {
		return this.mode === 'whitelist'
	}

	/** Returns true when any pubkey is allowed to publish (open mode). */
	public isOpenMode(): boolean {
		return this.mode === 'open'
	}

	/** Get the current mode string. */
	public getMode(): AuctionWhitelistMode {
		return this.mode
	}

	/** Add a single hex pubkey to the whitelist. */
	public addPubkey(pubkey: string): void {
		if (typeof pubkey !== 'string' || pubkey.length !== 64) {
			throw new Error('Invalid public key format')
		}
		this.whitelistedPubkeys.add(pubkey)
	}

	/** Check whether a pubkey is whitelisted. */
	public isWhitelisted(pubkey: string): boolean {
		return this.whitelistedPubkeys.has(pubkey)
	}

	/**
	 * Returns true if the pubkey is allowed to publish a kind-30408 auction
	 * event under the current mode.
	 *
	 * In 'open' mode every pubkey is allowed.
	 * In 'whitelist' mode only pubkeys in the set are allowed.
	 */
	public isAllowed(pubkey: string): boolean {
		if (this.mode === 'open') return true
		return this.whitelistedPubkeys.has(pubkey)
	}

	/** Get a copy of the whitelisted pubkeys set. */
	public getWhitelist(): Set<string> {
		return new Set(this.whitelistedPubkeys)
	}

	/** Replace the entire whitelist (does not change mode). */
	public setWhitelist(pubkeys: string[]): void {
		this.whitelistedPubkeys.clear()
		pubkeys.forEach((pk) => {
			if (typeof pk === 'string' && pk.length === 64) {
				this.whitelistedPubkeys.add(pk)
			}
		})
	}

	/** Number of pubkeys in the whitelist. */
	public size(): number {
		return this.whitelistedPubkeys.size
	}

	/** Clear all whitelisted pubkeys (does not change mode). */
	public clear(): void {
		this.whitelistedPubkeys.clear()
	}
}