import { Store } from '@tanstack/store'

// Notification types
export type NotificationType = 'order' | 'message' | 'order-update'

// Per-conversation unseen count
export type ConversationNotifications = Record<string, number> // pubkey -> count
export type ScopedLastSeenTimestamps = Record<string, number>

const getScopedLastSeen = (globalTimestamp: number, scopedTimestamps: ScopedLastSeenTimestamps, key?: string): number => {
	if (!key) return globalTimestamp
	return Math.max(globalTimestamp, scopedTimestamps[key] || 0)
}

const decrementUnseenCount = (currentCount: number, clearedCount?: number): number => {
	if (typeof clearedCount !== 'number') return currentCount
	return Math.max(0, currentCount - Math.max(0, clearedCount))
}

// Notification state interface
export interface NotificationState {
	// Unseen counts
	unseenOrders: number // New orders where user is seller
	unseenMessages: number // New messages in conversations
	unseenPurchases: number // Updates to orders where user is buyer
	unseenAuctionBids: number // New bids on auctions where user is seller
	unseenAuctionComments: number // New live-chat comments on seller auctions
	unseenAuctionEventComments: number // New NIP-22 comments on seller auctions
	unseenProductComments: number // New NIP-22 comments on seller products
	unseenAuctionLive: number // Scheduled auctions that just went live
	unseenAuctionSettlementBegins: number // Scheduled auctions that just ended
	unseenBidUpdates: number // New higher bids / settlements on auctions where user is bidder
	unseenByConversation: ConversationNotifications

	// Last seen timestamps (unix timestamp in seconds)
	lastSeenTimestamps: {
		orders: number
		purchases: number
		auctionBids: number
		auctionBidsByAuction: ScopedLastSeenTimestamps
		auctionComments: number
		auctionCommentsByAuction: ScopedLastSeenTimestamps
		auctionEventComments: number
		auctionEventCommentsByAuction: ScopedLastSeenTimestamps
		productComments: number
		productCommentsByProduct: ScopedLastSeenTimestamps
		auctionLive: number
		auctionLiveByAuction: ScopedLastSeenTimestamps
		auctionSettlementBegins: number
		auctionSettlementBeginsByAuction: ScopedLastSeenTimestamps
		bidUpdates: number
		messages: Record<string, number> // pubkey -> timestamp
	}

	// Track if we've initialized from localStorage
	isInitialized: boolean
}

// LocalStorage key
const STORAGE_KEY = 'nostr-market:notifications'

// Load state from localStorage
const loadFromStorage = (): Partial<NotificationState> => {
	try {
		const stored = localStorage.getItem(STORAGE_KEY)
		if (!stored) return {}
		return JSON.parse(stored)
	} catch (error) {
		console.error('Failed to load notifications from localStorage:', error)
		return {}
	}
}

// Save state to localStorage
const saveToStorage = (state: NotificationState) => {
	try {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				lastSeenTimestamps: state.lastSeenTimestamps,
			}),
		)
	} catch (error) {
		console.error('Failed to save notifications to localStorage:', error)
	}
}

// Initial state
const createInitialState = (): NotificationState => {
	const stored = loadFromStorage()
	return {
		unseenOrders: 0,
		unseenMessages: 0,
		unseenPurchases: 0,
		unseenAuctionBids: 0,
		unseenAuctionComments: 0,
		unseenAuctionEventComments: 0,
		unseenProductComments: 0,
		unseenAuctionLive: 0,
		unseenAuctionSettlementBegins: 0,
		unseenBidUpdates: 0,
		unseenByConversation: {},
		lastSeenTimestamps: {
			orders: stored.lastSeenTimestamps?.orders || 0,
			purchases: stored.lastSeenTimestamps?.purchases || 0,
			auctionBids: stored.lastSeenTimestamps?.auctionBids || 0,
			auctionBidsByAuction: stored.lastSeenTimestamps?.auctionBidsByAuction || {},
			auctionComments: stored.lastSeenTimestamps?.auctionComments || 0,
			auctionCommentsByAuction: stored.lastSeenTimestamps?.auctionCommentsByAuction || {},
			auctionEventComments: stored.lastSeenTimestamps?.auctionEventComments || 0,
			auctionEventCommentsByAuction: stored.lastSeenTimestamps?.auctionEventCommentsByAuction || {},
			productComments: stored.lastSeenTimestamps?.productComments || 0,
			productCommentsByProduct: stored.lastSeenTimestamps?.productCommentsByProduct || {},
			auctionLive: stored.lastSeenTimestamps?.auctionLive || 0,
			auctionLiveByAuction: stored.lastSeenTimestamps?.auctionLiveByAuction || {},
			auctionSettlementBegins: stored.lastSeenTimestamps?.auctionSettlementBegins || 0,
			auctionSettlementBeginsByAuction: stored.lastSeenTimestamps?.auctionSettlementBeginsByAuction || {},
			bidUpdates: stored.lastSeenTimestamps?.bidUpdates || 0,
			messages: stored.lastSeenTimestamps?.messages || {},
		},
		isInitialized: false,
	}
}

// Create the store
export const notificationStore = new Store<NotificationState>(createInitialState())

// Notification Actions
export const notificationActions = {
	/**
	 * Initialize the notification system
	 * This should be called once when the app starts
	 */
	initialize: () => {
		notificationStore.setState((state) => ({
			...state,
			isInitialized: true,
		}))
	},

	/**
	 * Update unseen order count
	 */
	setUnseenOrders: (count: number) => {
		notificationStore.setState((state) => ({
			...state,
			unseenOrders: Math.max(0, count),
		}))
	},

	/**
	 * Update unseen message count
	 */
	setUnseenMessages: (count: number) => {
		notificationStore.setState((state) => ({
			...state,
			unseenMessages: Math.max(0, count),
		}))
	},

	/**
	 * Update unseen purchase count
	 */
	setUnseenPurchases: (count: number) => {
		notificationStore.setState((state) => ({
			...state,
			unseenPurchases: Math.max(0, count),
		}))
	},

	/**
	 * Update unseen seller auction bid count
	 */
	setUnseenAuctionBids: (count: number) => {
		notificationStore.setState((state) => ({
			...state,
			unseenAuctionBids: Math.max(0, count),
		}))
	},

	/**
	 * Update unseen seller auction live-chat comment count
	 */
	setUnseenAuctionComments: (count: number) => {
		notificationStore.setState((state) => ({
			...state,
			unseenAuctionComments: Math.max(0, count),
		}))
	},

	/**
	 * Update unseen seller auction thread comment count
	 */
	setUnseenAuctionEventComments: (count: number) => {
		notificationStore.setState((state) => ({
			...state,
			unseenAuctionEventComments: Math.max(0, count),
		}))
	},

	/**
	 * Update unseen seller product comment count
	 */
	setUnseenProductComments: (count: number) => {
		notificationStore.setState((state) => ({
			...state,
			unseenProductComments: Math.max(0, count),
		}))
	},

	/**
	 * Update unseen scheduled-auction-live count
	 */
	setUnseenAuctionLive: (count: number) => {
		notificationStore.setState((state) => ({
			...state,
			unseenAuctionLive: Math.max(0, count),
		}))
	},

	/**
	 * Update unseen auction-ended / settlement-begins count
	 */
	setUnseenAuctionSettlementBegins: (count: number) => {
		notificationStore.setState((state) => ({
			...state,
			unseenAuctionSettlementBegins: Math.max(0, count),
		}))
	},

	/**
	 * Update unseen bidder auction update count
	 */
	setUnseenBidUpdates: (count: number) => {
		notificationStore.setState((state) => ({
			...state,
			unseenBidUpdates: Math.max(0, count),
		}))
	},

	/**
	 * Update unseen count for a specific conversation
	 */
	setUnseenForConversation: (pubkey: string, count: number) => {
		notificationStore.setState((state) => ({
			...state,
			unseenByConversation: {
				...state.unseenByConversation,
				[pubkey]: Math.max(0, count),
			},
		}))
	},

	/**
	 * Increment unseen order count
	 */
	incrementUnseenOrders: () => {
		notificationStore.setState((state) => ({
			...state,
			unseenOrders: state.unseenOrders + 1,
		}))
	},

	/**
	 * Increment unseen message count for a specific conversation
	 */
	incrementUnseenForConversation: (pubkey: string) => {
		notificationStore.setState((state) => ({
			...state,
			unseenMessages: state.unseenMessages + 1,
			unseenByConversation: {
				...state.unseenByConversation,
				[pubkey]: (state.unseenByConversation[pubkey] || 0) + 1,
			},
		}))
	},

	/**
	 * Increment unseen purchase count
	 */
	incrementUnseenPurchases: () => {
		notificationStore.setState((state) => ({
			...state,
			unseenPurchases: state.unseenPurchases + 1,
		}))
	},

	/**
	 * Increment unseen seller auction bid count
	 */
	incrementUnseenAuctionBids: () => {
		notificationStore.setState((state) => ({
			...state,
			unseenAuctionBids: state.unseenAuctionBids + 1,
		}))
	},

	/**
	 * Increment unseen seller auction live-chat comment count
	 */
	incrementUnseenAuctionComments: () => {
		notificationStore.setState((state) => ({
			...state,
			unseenAuctionComments: state.unseenAuctionComments + 1,
		}))
	},

	/**
	 * Increment unseen seller auction thread comment count
	 */
	incrementUnseenAuctionEventComments: () => {
		notificationStore.setState((state) => ({
			...state,
			unseenAuctionEventComments: state.unseenAuctionEventComments + 1,
		}))
	},

	/**
	 * Increment unseen seller product comment count
	 */
	incrementUnseenProductComments: () => {
		notificationStore.setState((state) => ({
			...state,
			unseenProductComments: state.unseenProductComments + 1,
		}))
	},

	/**
	 * Increment unseen scheduled-auction-live count
	 */
	incrementUnseenAuctionLive: () => {
		notificationStore.setState((state) => ({
			...state,
			unseenAuctionLive: state.unseenAuctionLive + 1,
		}))
	},

	/**
	 * Increment unseen auction-ended / settlement-begins count
	 */
	incrementUnseenAuctionSettlementBegins: () => {
		notificationStore.setState((state) => ({
			...state,
			unseenAuctionSettlementBegins: state.unseenAuctionSettlementBegins + 1,
		}))
	},

	/**
	 * Increment unseen bidder auction update count
	 */
	incrementUnseenBidUpdates: () => {
		notificationStore.setState((state) => ({
			...state,
			unseenBidUpdates: state.unseenBidUpdates + 1,
		}))
	},

	/**
	 * Mark all orders as seen
	 * Updates the last seen timestamp and resets unseen count
	 */
	markOrdersSeen: () => {
		const now = Math.floor(Date.now() / 1000)
		notificationStore.setState((state) => {
			const newState = {
				...state,
				unseenOrders: 0,
				lastSeenTimestamps: {
					...state.lastSeenTimestamps,
					orders: now,
				},
			}
			saveToStorage(newState)
			return newState
		})
	},

	/**
	 * Mark messages from a specific conversation as seen
	 * If no pubkey provided, marks all messages as seen
	 */
	markMessagesSeen: (pubkey?: string) => {
		const now = Math.floor(Date.now() / 1000)
		notificationStore.setState((state) => {
			if (pubkey) {
				// Mark specific conversation as seen
				const unseenForConvo = state.unseenByConversation[pubkey] || 0
				const newState = {
					...state,
					unseenMessages: Math.max(0, state.unseenMessages - unseenForConvo),
					unseenByConversation: {
						...state.unseenByConversation,
						[pubkey]: 0,
					},
					lastSeenTimestamps: {
						...state.lastSeenTimestamps,
						messages: {
							...state.lastSeenTimestamps.messages,
							[pubkey]: now,
						},
					},
				}
				saveToStorage(newState)
				return newState
			} else {
				// Mark all messages as seen
				const newState = {
					...state,
					unseenMessages: 0,
					unseenByConversation: {},
					lastSeenTimestamps: {
						...state.lastSeenTimestamps,
						messages: Object.keys(state.unseenByConversation).reduce(
							(acc, key) => {
								acc[key] = now
								return acc
							},
							{ ...state.lastSeenTimestamps.messages } as Record<string, number>,
						),
					},
				}
				saveToStorage(newState)
				return newState
			}
		})
	},

	/**
	 * Mark a specific conversation as seen
	 */
	markConversationSeen: (pubkey: string) => {
		notificationActions.markMessagesSeen(pubkey)
	},

	/**
	 * Mark all purchases as seen
	 * Updates the last seen timestamp and resets unseen count
	 */
	markPurchasesSeen: () => {
		const now = Math.floor(Date.now() / 1000)
		notificationStore.setState((state) => {
			const newState = {
				...state,
				unseenPurchases: 0,
				lastSeenTimestamps: {
					...state.lastSeenTimestamps,
					purchases: now,
				},
			}
			saveToStorage(newState)
			return newState
		})
	},

	/**
	 * Mark seller auction bid notifications as seen
	 */
	markAuctionBidsSeen: (auctionKey?: string, clearedCount?: number) => {
		const now = Math.floor(Date.now() / 1000)
		notificationStore.setState((state) => {
			const newState = {
				...state,
				unseenAuctionBids: auctionKey ? decrementUnseenCount(state.unseenAuctionBids, clearedCount) : 0,
				lastSeenTimestamps: {
					...state.lastSeenTimestamps,
					auctionBids: auctionKey ? state.lastSeenTimestamps.auctionBids : now,
					auctionBidsByAuction: auctionKey
						? {
								...state.lastSeenTimestamps.auctionBidsByAuction,
								[auctionKey]: now,
							}
						: state.lastSeenTimestamps.auctionBidsByAuction,
				},
			}
			saveToStorage(newState)
			return newState
		})
	},

	/**
	 * Mark seller auction live-chat comment notifications as seen
	 */
	markAuctionCommentsSeen: (auctionKey?: string, clearedCount?: number) => {
		const now = Math.floor(Date.now() / 1000)
		notificationStore.setState((state) => {
			const newState = {
				...state,
				unseenAuctionComments: auctionKey ? decrementUnseenCount(state.unseenAuctionComments, clearedCount) : 0,
				lastSeenTimestamps: {
					...state.lastSeenTimestamps,
					auctionComments: auctionKey ? state.lastSeenTimestamps.auctionComments : now,
					auctionCommentsByAuction: auctionKey
						? {
								...state.lastSeenTimestamps.auctionCommentsByAuction,
								[auctionKey]: now,
							}
						: state.lastSeenTimestamps.auctionCommentsByAuction,
				},
			}
			saveToStorage(newState)
			return newState
		})
	},

	/**
	 * Mark seller auction thread comment notifications as seen
	 */
	markAuctionEventCommentsSeen: (auctionKey?: string, clearedCount?: number) => {
		const now = Math.floor(Date.now() / 1000)
		notificationStore.setState((state) => {
			const newState = {
				...state,
				unseenAuctionEventComments: auctionKey ? decrementUnseenCount(state.unseenAuctionEventComments, clearedCount) : 0,
				lastSeenTimestamps: {
					...state.lastSeenTimestamps,
					auctionEventComments: auctionKey ? state.lastSeenTimestamps.auctionEventComments : now,
					auctionEventCommentsByAuction: auctionKey
						? {
								...state.lastSeenTimestamps.auctionEventCommentsByAuction,
								[auctionKey]: now,
							}
						: state.lastSeenTimestamps.auctionEventCommentsByAuction,
				},
			}
			saveToStorage(newState)
			return newState
		})
	},

	/**
	 * Mark seller product comment notifications as seen
	 */
	markProductCommentsSeen: (productKey?: string, clearedCount?: number) => {
		const now = Math.floor(Date.now() / 1000)
		notificationStore.setState((state) => {
			const newState = {
				...state,
				unseenProductComments: productKey ? decrementUnseenCount(state.unseenProductComments, clearedCount) : 0,
				lastSeenTimestamps: {
					...state.lastSeenTimestamps,
					productComments: productKey ? state.lastSeenTimestamps.productComments : now,
					productCommentsByProduct: productKey
						? {
								...state.lastSeenTimestamps.productCommentsByProduct,
								[productKey]: now,
							}
						: state.lastSeenTimestamps.productCommentsByProduct,
				},
			}
			saveToStorage(newState)
			return newState
		})
	},

	/**
	 * Mark scheduled-auction-live notifications as seen
	 */
	markAuctionLiveSeen: (auctionKey?: string, clearedCount?: number) => {
		const now = Math.floor(Date.now() / 1000)
		notificationStore.setState((state) => {
			const newState = {
				...state,
				unseenAuctionLive: auctionKey ? decrementUnseenCount(state.unseenAuctionLive, clearedCount) : 0,
				lastSeenTimestamps: {
					...state.lastSeenTimestamps,
					auctionLive: auctionKey ? state.lastSeenTimestamps.auctionLive : now,
					auctionLiveByAuction: auctionKey
						? {
								...state.lastSeenTimestamps.auctionLiveByAuction,
								[auctionKey]: now,
							}
						: state.lastSeenTimestamps.auctionLiveByAuction,
				},
			}
			saveToStorage(newState)
			return newState
		})
	},

	/**
	 * Mark auction-ended / settlement-begins notifications as seen
	 */
	markAuctionSettlementBeginsSeen: (auctionKey?: string, clearedCount?: number) => {
		const now = Math.floor(Date.now() / 1000)
		notificationStore.setState((state) => {
			const newState = {
				...state,
				unseenAuctionSettlementBegins: auctionKey ? decrementUnseenCount(state.unseenAuctionSettlementBegins, clearedCount) : 0,
				lastSeenTimestamps: {
					...state.lastSeenTimestamps,
					auctionSettlementBegins: auctionKey ? state.lastSeenTimestamps.auctionSettlementBegins : now,
					auctionSettlementBeginsByAuction: auctionKey
						? {
								...state.lastSeenTimestamps.auctionSettlementBeginsByAuction,
								[auctionKey]: now,
							}
						: state.lastSeenTimestamps.auctionSettlementBeginsByAuction,
				},
			}
			saveToStorage(newState)
			return newState
		})
	},

	/**
	 * Mark bidder auction update notifications as seen
	 */
	markBidUpdatesSeen: () => {
		const now = Math.floor(Date.now() / 1000)
		notificationStore.setState((state) => {
			const newState = {
				...state,
				unseenBidUpdates: 0,
				lastSeenTimestamps: {
					...state.lastSeenTimestamps,
					bidUpdates: now,
				},
			}
			saveToStorage(newState)
			return newState
		})
	},

	/**
	 * Get last seen timestamp for orders
	 */
	getLastSeenOrders: (): number => {
		return notificationStore.state.lastSeenTimestamps.orders
	},

	/**
	 * Get last seen timestamp for a specific conversation
	 */
	getLastSeenForConversation: (pubkey: string): number => {
		return notificationStore.state.lastSeenTimestamps.messages[pubkey] || 0
	},

	/**
	 * Get last seen timestamp for purchases
	 */
	getLastSeenPurchases: (): number => {
		return notificationStore.state.lastSeenTimestamps.purchases
	},

	/**
	 * Get last seen timestamp for seller auction bids
	 */
	getLastSeenAuctionBids: (auctionKey?: string): number => {
		return getScopedLastSeen(
			notificationStore.state.lastSeenTimestamps.auctionBids,
			notificationStore.state.lastSeenTimestamps.auctionBidsByAuction,
			auctionKey,
		)
	},

	/**
	 * Get last seen timestamp for seller auction live-chat comments
	 */
	getLastSeenAuctionComments: (auctionKey?: string): number => {
		return getScopedLastSeen(
			notificationStore.state.lastSeenTimestamps.auctionComments,
			notificationStore.state.lastSeenTimestamps.auctionCommentsByAuction,
			auctionKey,
		)
	},

	/**
	 * Get last seen timestamp for seller auction thread comments
	 */
	getLastSeenAuctionEventComments: (auctionKey?: string): number => {
		return getScopedLastSeen(
			notificationStore.state.lastSeenTimestamps.auctionEventComments,
			notificationStore.state.lastSeenTimestamps.auctionEventCommentsByAuction,
			auctionKey,
		)
	},

	/**
	 * Get last seen timestamp for seller product comments
	 */
	getLastSeenProductComments: (productKey?: string): number => {
		return getScopedLastSeen(
			notificationStore.state.lastSeenTimestamps.productComments,
			notificationStore.state.lastSeenTimestamps.productCommentsByProduct,
			productKey,
		)
	},

	/**
	 * Get last seen timestamp for scheduled-auction-live notifications
	 */
	getLastSeenAuctionLive: (auctionKey?: string): number => {
		return getScopedLastSeen(
			notificationStore.state.lastSeenTimestamps.auctionLive,
			notificationStore.state.lastSeenTimestamps.auctionLiveByAuction,
			auctionKey,
		)
	},

	/**
	 * Get last seen timestamp for auction-ended / settlement-begins notifications
	 */
	getLastSeenAuctionSettlementBegins: (auctionKey?: string): number => {
		return getScopedLastSeen(
			notificationStore.state.lastSeenTimestamps.auctionSettlementBegins,
			notificationStore.state.lastSeenTimestamps.auctionSettlementBeginsByAuction,
			auctionKey,
		)
	},

	/**
	 * Get last seen timestamp for bidder auction updates
	 */
	getLastSeenBidUpdates: (): number => {
		return notificationStore.state.lastSeenTimestamps.bidUpdates
	},

	/**
	 * Reset all notifications
	 */
	reset: () => {
		const newState = createInitialState()
		notificationStore.setState(() => newState)
		localStorage.removeItem(STORAGE_KEY)
	},

	/**
	 * Recalculate unseen counts based on provided events
	 * This is used by the monitor to sync with actual data
	 */
	recalculateFromEvents: (data: {
		orderCount: number
		messageCount: number
		purchaseCount: number
		conversationCounts: ConversationNotifications
		auctionBidCount?: number
		auctionCommentCount?: number
		auctionEventCommentCount?: number
		productCommentCount?: number
		auctionLiveCount?: number
		auctionSettlementBeginsCount?: number
		bidUpdateCount?: number
	}) => {
		notificationStore.setState((state) => ({
			...state,
			unseenOrders: data.orderCount,
			unseenMessages: data.messageCount,
			unseenPurchases: data.purchaseCount,
			unseenAuctionBids: data.auctionBidCount ?? 0,
			unseenAuctionComments: data.auctionCommentCount ?? 0,
			unseenAuctionEventComments: data.auctionEventCommentCount ?? 0,
			unseenProductComments: data.productCommentCount ?? 0,
			unseenAuctionLive: data.auctionLiveCount ?? 0,
			unseenAuctionSettlementBegins: data.auctionSettlementBeginsCount ?? 0,
			unseenBidUpdates: data.bidUpdateCount ?? 0,
			unseenByConversation: data.conversationCounts,
		}))
	},
}

// React hook for consuming the store
export const useNotifications = () => {
	return {
		...notificationStore.state,
		...notificationActions,
	}
}
