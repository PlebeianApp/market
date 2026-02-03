import { authStore } from '@/lib/stores/auth'
import { ndkActions } from '@/lib/stores/ndk'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { NDKCashuWallet, type NDKWalletBalance } from '@nostr-dev-kit/wallet'
import { useStore } from '@tanstack/react-store'
import { ArrowDownLeft, ArrowUpRight, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

// NIP-60 Spending History kind
const CASHU_HISTORY_KIND = 7376

interface Transaction {
	id: string
	direction: 'in' | 'out'
	amount: number
	unit: string
	createdAt: number
}

export function Nip60Wallet() {
	const { isAuthenticated, user } = useStore(authStore)
	const [balance, setBalance] = useState<number | null>(null)
	const [transactions, setTransactions] = useState<Transaction[]>([])
	const [isLoading, setIsLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		if (!isAuthenticated || !user?.pubkey) {
			setBalance(null)
			setTransactions([])
			setIsLoading(false)
			return
		}

		let wallet: NDKCashuWallet | undefined
		let isMounted = true

		const initWallet = async () => {
			try {
				setIsLoading(true)
				setError(null)

				const ndk = ndkActions.getNDK()
				if (!ndk) {
					throw new Error('NDK not initialized')
				}

				// Create wallet - start() will discover existing wallet events
				wallet = new NDKCashuWallet(ndk)

				// Subscribe to balance updates
				wallet.on('balance_updated', (newBalance?: NDKWalletBalance) => {
					console.log('[Nip60Wallet] Balance updated:', newBalance)
					if (isMounted) {
						setBalance(newBalance?.amount ?? 0)
					}
				})

				// Start the wallet - this discovers existing wallet events
				console.log('[Nip60Wallet] Starting wallet...')
				await wallet.start()
				console.log('[Nip60Wallet] Wallet started, mints:', wallet.mints)

				// Get initial balance
				const initialBalance = wallet.balance
				console.log('[Nip60Wallet] Initial balance:', initialBalance)
				if (isMounted) {
					setBalance(initialBalance?.amount ?? 0)
				}

				// Fetch transaction history (kind:7376)
				const historyEvents = await ndk.fetchEvents([{ kinds: [CASHU_HISTORY_KIND], authors: [user.pubkey], limit: 20 }])
				console.log('[Nip60Wallet] History events found:', historyEvents.size)
				console.log(
					'[Nip60Wallet] History events:',
					Array.from(historyEvents).map((e) => ({ id: e.id, content: e.content, tags: e.tags, created_at: e.created_at })),
				)

				const txs: Transaction[] = []
				for (const historyEvent of Array.from(historyEvents)) {
					try {
						const tx = await parseHistoryEvent(historyEvent)
						if (tx) txs.push(tx)
					} catch (e) {
						console.warn('Failed to parse history event:', e)
					}
				}

				// Sort by created_at descending (newest first)
				txs.sort((a, b) => b.createdAt - a.createdAt)

				if (isMounted) {
					setTransactions(txs)
					setIsLoading(false)
				}
			} catch (err) {
				console.error('Failed to load NIP-60 wallet:', err)
				if (isMounted) {
					setError(err instanceof Error ? err.message : 'Failed to load wallet')
					setIsLoading(false)
				}
			}
		}

		initWallet()

		return () => {
			isMounted = false
			if (wallet) {
				wallet.removeAllListeners?.()
			}
		}
	}, [isAuthenticated, user?.pubkey])

	async function parseHistoryEvent(event: NDKEvent): Promise<Transaction | null> {
		const ndk = ndkActions.getNDK()
		if (!ndk?.signer) return null

		console.log('[Nip60Wallet] Parsing history event:', {
			id: event.id,
			contentLength: event.content?.length,
			contentPreview: event.content?.substring(0, 100),
			tags: event.tags,
		})

		try {
			// Check if content exists and is a string
			if (!event.content || typeof event.content !== 'string' || event.content.trim() === '') {
				console.log('[Nip60Wallet] Skipping event with empty/invalid content:', event.id)
				return null
			}

			let tags: string[][]

			// Check if content is already JSON (unencrypted)
			if (event.content.startsWith('[')) {
				try {
					tags = JSON.parse(event.content) as string[][]
					console.log('[Nip60Wallet] Content was unencrypted JSON')
				} catch {
					// Not valid JSON, try decryption
					tags = await decryptContent(event, ndk)
				}
			} else {
				// Content is encrypted, decrypt it
				tags = await decryptContent(event, ndk)
			}

			let direction: 'in' | 'out' = 'out'
			let amount = 0
			let unit = 'sat'

			for (const tag of tags) {
				if (tag[0] === 'direction') direction = tag[1] as 'in' | 'out'
				if (tag[0] === 'amount') amount = parseInt(tag[1], 10)
				if (tag[0] === 'unit') unit = tag[1]
			}

			console.log('[Nip60Wallet] Parsed transaction:', { direction, amount, unit })

			return {
				id: event.id,
				direction,
				amount,
				unit,
				createdAt: event.created_at || 0,
			}
		} catch (e) {
			console.warn('[Nip60Wallet] Failed to decrypt history event:', event.id, e)
			return null
		}
	}

	async function decryptContent(event: NDKEvent, ndk: NonNullable<ReturnType<typeof ndkActions.getNDK>>): Promise<string[][]> {
		// Set the ndk on the event if not set
		if (!event.ndk) {
			event.ndk = ndk
		}

		// Try using NDKEvent's decrypt method first (handles NIP-44 automatically)
		try {
			const signerUser = await ndk.signer!.user()
			await event.decrypt(signerUser)
			console.log('[Nip60Wallet] Decrypted via event.decrypt:', event.content?.substring(0, 200))
			return JSON.parse(event.content) as string[][]
		} catch (eventDecryptError) {
			console.log('[Nip60Wallet] event.decrypt failed:', eventDecryptError)
		}

		// Fallback to signer decrypt
		try {
			const signer = ndk.signer!
			const user = await signer.user()
			const decrypted = await signer.decrypt(user, event.content)
			console.log('[Nip60Wallet] Decrypted via signer.decrypt:', decrypted?.substring(0, 200))
			return JSON.parse(decrypted) as string[][]
		} catch (signerDecryptError) {
			console.log('[Nip60Wallet] signer.decrypt failed:', signerDecryptError)
		}

		throw new Error('Failed to decrypt content with all methods')
	}

	if (!isAuthenticated) {
		return (
			<div className="p-4 text-center text-muted-foreground">
				<p>Please log in to view your wallet</p>
			</div>
		)
	}

	if (isLoading) {
		return (
			<div className="flex items-center justify-center p-4">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		)
	}

	if (error) {
		return (
			<div className="p-4 text-center text-destructive">
				<p>{error}</p>
			</div>
		)
	}

	return (
		<div className="p-4">
			<div className="text-center mb-4">
				<p className="text-sm text-muted-foreground mb-1">Balance</p>
				<p className="text-2xl font-bold">{balance !== null ? `${balance.toLocaleString()} sats` : '0 sats'}</p>
			</div>

			{transactions.length > 0 && (
				<div className="border-t pt-4">
					<p className="text-sm font-medium mb-2">Recent Transactions</p>
					<div className="space-y-2 max-h-48 overflow-y-auto">
						{transactions.map((tx) => (
							<div key={tx.id} className="flex items-center justify-between text-sm">
								<div className="flex items-center gap-2">
									{tx.direction === 'in' ? (
										<ArrowDownLeft className="w-4 h-4 text-green-500" />
									) : (
										<ArrowUpRight className="w-4 h-4 text-red-500" />
									)}
									<span className="text-muted-foreground">{new Date(tx.createdAt * 1000).toLocaleDateString()}</span>
								</div>
								<span className={tx.direction === 'in' ? 'text-green-500' : 'text-red-500'}>
									{tx.direction === 'in' ? '+' : '-'}
									{tx.amount.toLocaleString()} {tx.unit}
								</span>
							</div>
						))}
					</div>
				</div>
			)}

			{transactions.length === 0 && (
				<div className="border-t pt-4 text-center text-muted-foreground text-sm">
					<p>No transactions yet</p>
				</div>
			)}
		</div>
	)
}
