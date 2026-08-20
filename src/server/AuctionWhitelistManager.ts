import type { AuctionWhitelistConfig } from './types'

/**
 * Manages auction publishing whitelist.
 * Mode 'open' = any pubkey can publish auctions.
 * Mode 'whitelist' = only listed pubkeys can publish.
 *
 * The config is normalized at construction time (see
 * `getAuctionWhitelistConfig` in runtime.ts): any mode other than the
 * exact string `whitelist` degrades to `open`, and pubkey entries are
 * trimmed with empty entries dropped.
 */
export class AuctionWhitelistManager {
	private mode: AuctionWhitelistConfig['mode']
	private pubkeys: Set<string>

	constructor(config: AuctionWhitelistConfig) {
		this.mode = config.mode === 'whitelist' ? 'whitelist' : 'open'
		this.pubkeys = new Set(config.pubkeys.map((pubkey) => pubkey.trim()).filter(Boolean))
	}

	isAllowed(pubkey: string): boolean {
		if (this.mode === 'open') return true
		return this.pubkeys.has(pubkey)
	}

	getConfig(): { mode: AuctionWhitelistConfig['mode']; pubkeyCount: number } {
		return { mode: this.mode, pubkeyCount: this.pubkeys.size }
	}
}
