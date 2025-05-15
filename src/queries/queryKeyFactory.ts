export const productKeys = {
	all: ['products'] as const,
	details: (id: string) => [...productKeys.all, id] as const,
	byPubkey: (pubkey: string) => [...productKeys.all, 'byPubkey', pubkey] as const,
	seller: (id: string) => [...productKeys.all, 'seller', id] as const,
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
} as const
