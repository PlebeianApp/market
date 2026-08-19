/**
 * Manages auction publishing whitelist.
 * Mode 'open' = any pubkey can publish auctions.
 * Mode 'whitelist' = only listed pubkeys can publish.
 */
export class AuctionWhitelistManager {
	private mode: 'whitelist' | 'open'
	private pubkeys: Set<string>

	constructor(config: { mode: string; pubkeys: string[] }) {
		this.mode = config.mode === 'whitelist' ? 'whitelist' : 'open'
		this.pubkeys = new Set(config.pubkeys)
	}

	isAllowed(pubkey: string): boolean {
		if (this.mode === 'open') return true
		return this.pubkeys.has(pubkey)
	}

	getConfig(): { mode: string; pubkeyCount: number } {
		return { mode: this.mode, pubkeyCount: this.pubkeys.size }
	}
}
