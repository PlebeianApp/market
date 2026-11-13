import { nip60Actions, nip60Store } from '@/lib/stores/nip60'
import { normalizePaymentMintUrl, type PaidCallWallet, type PaidClientExecutor } from '@sdk/core/extensions'
import { draftListingWithCashu, routstrListingDrafterManifest } from '@sdk/extensions/routstr-listing-drafter'

/**
 * Browser executors for user-paid actions, keyed `extensionId/actionName`. Only built-in extensions can ship one:
 * a remote extension's descriptor may carry a price, but with no executor here its action is not callable.
 */
const PAID_EXECUTORS: Readonly<Record<string, PaidClientExecutor<any, any>>> = {
	[`${routstrListingDrafterManifest.id}/draft-listing`]: draftListingWithCashu,
}

export function findPaidExecutor(extensionId: string, actionName: string): PaidClientExecutor<any, any> | undefined {
	return PAID_EXECUTORS[`${extensionId}/${actionName}`]
}

/** Wallet keys may differ from a requirement's mint by a trailing slash. */
function walletMintKey(mint: string): string | undefined {
	const wanted = normalizePaymentMintUrl(mint)
	return Object.keys(nip60Store.state.mintBalances).find((key) => normalizePaymentMintUrl(key) === wanted)
}

/** The header's NIP-60 wallet, adapted for paid extension calls. */
export const nip60PaidCallWallet: PaidCallWallet = {
	balanceAt(mint) {
		if (nip60Store.state.status !== 'ready') return 0
		const key = walletMintKey(mint)
		return key ? (nip60Store.state.mintBalances[key] ?? 0) : 0
	},
	async send(mint, amount) {
		const key = walletMintKey(mint)
		if (!key) throw new Error('Mint not in wallet')
		const token = await nip60Actions.sendEcash(amount, key)
		if (!token) throw new Error('Wallet did not create a token')
		return token
	},
	async receive(token) {
		const before = nip60Store.state.balance
		const received = await nip60Actions.receiveEcash(token)
		if (!received) throw new Error('Token not received')
		return Math.max(0, nip60Store.state.balance - before)
	},
	async reclaim(token) {
		const pending = nip60Store.state.pendingTokens.find((entry) => entry.token === token)
		if (!pending) return false
		try {
			await nip60Actions.reclaimToken(pending.id, { manual: true })
		} catch {
			return false
		}
		return nip60Store.state.pendingTokens.find((entry) => entry.id === pending.id)?.status === 'reclaimed'
	},
}
