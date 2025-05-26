export type ObjectValues<T> = T[keyof T]

export const defaultRelaysUrls: string[] = ['wss://relay.nostr.band', 'wss://nos.lol', 'wss://relay.nostr.net', 'wss://relay.damus.io']
// export const defaultRelaysUrls: string[] = []

export const CURRENCIES = [
	'SATS', // Satoshis
	'BTC', // Bitcoin
	'USD', // United States Dollar
	'EUR', // Euro
	'JPY', // Japanese Yen
	'GBP', // Pound Sterling
	'CHF', // Swiss Franc
	'CNY', // Chinese Renminbi (RMB)
	'AUD', // Australian Dollar
	'CAD', // Canadian Dollar
	'HKD', // Hong Kong Dollar
	'SGD', // Singapore Dollar
	'INR', // Indian Rupee
	'MXN', // Mexican Peso
	'RUB', // Russian Ruble
	'BRL', // Brazilian Real
	'TRY', // Turkish Lira
	'KRW', // South Korean Won
	'ZAR', // South African Rand
	'ARS', // Argentine Peso
	'CLP', // Chilean Peso
	'COP', // Colombian Peso
	'PEN', // Peruvian Sol
	'UYU', // Uruguayan Peso
	'PHP', // Philippine Peso
	'THB', // Thai Baht
	'IDR', // Indonesian Rupiah
	'MYR', // Malaysian Ringgit
] as const

export const DEFAULT_ZAP_AMOUNTS = [
	{ displayText: '😊 10 sats', amount: 10 },
	{ displayText: '😄 21 sats', amount: 21 },
	{ displayText: '😃 50 sats', amount: 50 },
	{ displayText: '😁 100 sats', amount: 100 },
	{ displayText: '🤩 1,000 sats', amount: 1000 },
	{ displayText: '🚀 10,000 sats', amount: 10000 },
	{ displayText: '🔥 100,000 sats', amount: 100000 },
	{ displayText: '🤯 1,000,000 sats', amount: 1000000 },
]

export const HEX_KEYS_REGEX = /^(?:[0-9a-fA-F]{64})$/
export const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export const PAYMENT_DETAILS_METHOD = {
	LIGHTNING_NETWORK: 'ln',
	ON_CHAIN: 'on-chain',
	// CASHU: 'cashu',
	// OTHER: 'other',
} as const

export type PaymentDetailsMethod = ObjectValues<typeof PAYMENT_DETAILS_METHOD>
