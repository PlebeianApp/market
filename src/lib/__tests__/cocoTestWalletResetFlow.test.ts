import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const walletSource = readFileSync(new URL('../../feature/wallet/components/Nip60Wallet.tsx', import.meta.url), 'utf8')

describe('Coco test-wallet reset UI contract', () => {
	test('waits for the signed-in NIP-60 inventory before running the fresh preflight', () => {
		expect(walletSource).toContain("status !== 'ready' && status !== 'no_wallet'")
		expect(walletSource).toContain('nip60Store.state.account !== user.pubkey.trim().toLowerCase()')
		expect(walletSource).toContain('[cocoMode, isAuthenticated, user?.pubkey, status]')
	})

	test('recommits authority in place without reloading or losing the signer session', () => {
		const resetHandler = walletSource.slice(
			walletSource.indexOf('const handleResetCocoTestWallet'),
			walletSource.indexOf('const classNameGhost'),
		)
		expect(resetHandler).toContain('await resetBrowserCocoAuctionTestState')
		expect(resetHandler).toContain('await ensureBrowserFreshAuctionsdevPreflight')
		expect(resetHandler).toContain('await getCocoAuctionBalances')
		expect(resetHandler).toContain('setCocoSetupBlocked(false)')
		expect(resetHandler).not.toContain('window.location.reload')
	})
})
