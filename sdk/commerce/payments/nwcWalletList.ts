import type { EventPublishContext } from '../../core/ports/eventPublish'
import type { SignedEventLike } from '../../core/ports/signer'
import { NIP89_CLIENT_SOFTWARE_NAME } from '../../core/nip89/handlerInfo'
import { signAndPublish } from '../../core/publishing'

export const USER_NWC_WALLET_LIST_KIND = 30078
export const USER_NWC_WALLET_LIST_LABEL = 'market_user_nwc_wallets'

export interface NwcWalletListPublishContext<SignedEvent extends SignedEventLike> extends EventPublishContext<SignedEvent> {
	/** Encrypts to the author's own pubkey; the content carries NWC URIs, so it must never be published in plaintext. */
	encryptToSelf(plaintext: string): Promise<string>
}

export async function publishNwcWalletListWorkflow<SignedEvent extends SignedEventLike, Wallet extends object>(
	context: NwcWalletListPublishContext<SignedEvent>,
	wallets: readonly Wallet[],
): Promise<SignedEvent> {
	const stored = wallets.map((wallet) => ({ ...wallet, storedOnNostr: true }))
	const content = await context.encryptToSelf(JSON.stringify(stored))
	return signAndPublish(context, {
		kind: USER_NWC_WALLET_LIST_KIND,
		content,
		tags: [
			['l', USER_NWC_WALLET_LIST_LABEL],
			['client', NIP89_CLIENT_SOFTWARE_NAME],
		],
	})
}
