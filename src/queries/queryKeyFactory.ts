export const productKeys = {
	all: ['products'] as const,
	details: (id: string) => [...productKeys.all, id] as const,
	byPubkey: (pubkey: string) => [...productKeys.all, 'byPubkey', pubkey] as const,
	byATag: (pubkey: string, dTag: string) => [...productKeys.all, 'byATag', pubkey, dTag] as const,
	byCollection: (collectionId: string) => [...productKeys.all, 'byCollection', collectionId] as const,
	seller: (id: string) => [...productKeys.all, 'seller', id] as const,
	paginated: (limit: number, until?: number) => [...productKeys.all, 'paginated', limit, until] as const,
} as const

export const orderKeys = {
	all: ['orders'] as const,
	details: (id: string) => [...orderKeys.all, id] as const,
	byPubkey: (pubkey: string) => [...orderKeys.all, 'byPubkey', pubkey] as const,
	bySeller: (pubkey: string) => [...orderKeys.all, 'bySeller', pubkey] as const,
	byBuyer: (pubkey: string) => [...orderKeys.all, 'byBuyer', pubkey] as const,
} as const

export const shippingKeys = {
	all: ['shipping'] as const,
	details: (id: string) => [...shippingKeys.all, id] as const,
	byPubkey: (pubkey: string) => [...shippingKeys.all, 'byPubkey', pubkey] as const,
	byCoordinates: (pubkey: string, dTag: string) => [...shippingKeys.all, 'byCoordinates', pubkey, dTag] as const,
} as const

export const collectionKeys = {
	all: ['collections'] as const,
	details: (id: string) => [...collectionKeys.all, id] as const,
	byPubkey: (pubkey: string) => [...collectionKeys.all, 'byPubkey', pubkey] as const,
	byATag: (pubkey: string, dTag: string) => [...collectionKeys.all, 'byATag', pubkey, dTag] as const,
} as const

export const collectionsKeys = {
	all: ['collections'] as const,
	details: (id: string) => [...collectionsKeys.all, id] as const,
	byPubkey: (pubkey: string) => [...collectionsKeys.all, 'byPubkey', pubkey] as const,
} as const

export const profileKeys = {
	all: ['profiles'] as const,
	details: (p: string) => [...profileKeys.all, p] as const,
	nip05: (p: string) => [...profileKeys.all, 'nip05', p] as const,
	detailsByNip05: (nip05: string) => [...profileKeys.all, 'byNip05', nip05] as const,
	zapCapability: (p: string) => [...profileKeys.all, 'zapCapability', p] as const,
} as const

export const postKeys = {
	all: ['posts'] as const,
	details: (id: string) => [...postKeys.all, id] as const,
} as const

export const userKeys = {
	all: ['users'] as const,
	details: (pubkey: string) => ['user', pubkey] as const,
} as const

export const authorKeys = {
	all: ['authors'] as const,
	details: (id: string) => [...authorKeys.all, id] as const,
} as const

export const configKeys = {
	all: ['config'] as const,
	appRelay: () => [...configKeys.all, 'appRelay'] as const,
	admins: (appPubkey: string) => [...configKeys.all, 'admins', appPubkey] as const,
	editors: (appPubkey: string) => [...configKeys.all, 'editors', appPubkey] as const,
	blacklist: (appPubkey: string) => [...configKeys.all, 'blacklist', appPubkey] as const,
	featuredProducts: (appPubkey: string) => [...configKeys.all, 'featuredProducts', appPubkey] as const,
	featuredCollections: (appPubkey: string) => [...configKeys.all, 'featuredCollections', appPubkey] as const,
	featuredUsers: (appPubkey: string) => [...configKeys.all, 'featuredUsers', appPubkey] as const,
} as const

export const appSettingsKeys = {
	all: ['appSettings'] as const,
} as const

export const currencyKeys = {
	all: ['currency'] as const,
	rates: () => [...currencyKeys.all, 'rates'] as const,
	btc: () => [...currencyKeys.rates(), 'BTC'] as const,
	forCurrency: (currency: string) => [...currencyKeys.rates(), currency] as const,
	conversion: (currency: string, amount: number) => [...currencyKeys.all, 'conversion', currency, amount.toString()] as const,
}

export const v4vKeys = {
	all: ['v4v'] as const,
	userShares: (pubkey: string) => [...v4vKeys.all, 'shares', pubkey] as const,
	publishShare: () => [...v4vKeys.all, 'publish'] as const,
	merchants: () => [...v4vKeys.all, 'merchants'] as const,
} as const

export const walletKeys = {
	all: ['wallet'] as const,
	// details: (paymentDetailsEvent: string) => [...walletKeys.all, 'details', paymentDetailsEvent] as const,
	// byPubkey: (pubkey: string) => [...walletKeys.all, 'byPubkey', pubkey] as const,
	userNwcWallets: (userPubkey: string) => [...walletKeys.all, 'userNwcWallets', userPubkey] as const,
	// publish: () => [...walletKeys.all, 'publish'] as const,
	nwcBalance: (nwcUri: string) => [...walletKeys.all, 'nwcBalance', nwcUri] as const,
} as const

export const paymentDetailsKeys = {
	all: ['paymentDetails'] as const,
	details: (id: string) => [...paymentDetailsKeys.all, id] as const,
	byPubkey: (pubkey: string | undefined) => [...paymentDetailsKeys.all, 'byPubkey', pubkey || ''] as const,
	byProductOrCollection: (d: string) => [...paymentDetailsKeys.all, 'byCoordinates', d],
	availableOptions: (sellerPubkey: string, productIds: string[]) =>
		[...paymentDetailsKeys.all, 'availableOptions', sellerPubkey, productIds.sort().join(',')] as const,
	publish: () => [...paymentDetailsKeys.all, 'publish'] as const,
	updatePaymentDetail: () => [...paymentDetailsKeys.all, 'update'] as const,
	deletePaymentDetail: () => [...paymentDetailsKeys.all, 'delete'] as const,
	paymentReceipt: (orderId: string, invoiceId: string) => [...paymentDetailsKeys.all, 'receipt', orderId, invoiceId],
} as const

export const walletDetailsKeys = {
	all: ['walletDetails'] as const,
	onChainIndex: (userPubkey: string, paymentDetailId: string) =>
		[...walletDetailsKeys.all, 'onChainIndex', userPubkey, paymentDetailId] as const,
	publish: () => [...walletDetailsKeys.all, 'publish'] as const,
	delete: () => [...walletDetailsKeys.all, 'delete'] as const,
} as const

export const messageKeys = {
	all: ['messages'] as const,
	conversationsList: (currentUserPubkey: string | undefined) => [...messageKeys.all, 'conversations', currentUserPubkey || 'all'] as const,
	conversationMessages: (currentUserPubkey: string | undefined, otherUserPubkey: string | undefined) =>
		[...messageKeys.all, 'conversation', currentUserPubkey || 'na', otherUserPubkey || 'na'] as const,
} as const

export const migrationKeys = {
	all: ['migration'] as const,
	nip15Products: (userPubkey: string) => [...migrationKeys.all, 'nip15', userPubkey] as const,
	migratedEvents: (userPubkey: string) => [...migrationKeys.all, 'migrated', userPubkey] as const,
} as const
