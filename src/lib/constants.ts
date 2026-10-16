export type ObjectValues<T> = T[keyof T]

// =============================================================================
// ENVIRONMENT STAGES
// =============================================================================

export type Stage = 'production' | 'staging' | 'development'

// =============================================================================
// RELAY CONFIGURATION
// =============================================================================

/**
 * Main relay URL per stage - this is the primary relay for each environment
 */
export const MAIN_RELAY_BY_STAGE: Record<Stage, string> = {
	production: 'wss://relay.plebeian.market',
	staging: 'wss://relay.staging.plebeian.market',
	development: 'ws://localhost:10547',
}

/**
 * Default public relays that are used in addition to the main relay
 * These are used for reading events from the broader Nostr network
 */
export const DEFAULT_NIP46_RELAYS = [
	{ value: 'wss://relay.plebeian.market', label: 'relay.plebeian.market' },
	{ value: 'wss://relay.nsec.app', label: 'relay.nsec.app' },
	{ value: 'wss://relay.damus.io', label: 'relay.damus.io' },
	{ value: 'wss://nos.lol', label: 'nos.lol' },
	{ value: 'wss://relay.primal.net', label: 'relay.primal.net' },
]

/**
 * Default public relays that are used in addition to the main relay
 * These are used for reading events from the broader Nostr network
 */
export const DEFAULT_PUBLIC_RELAYS: string[] = [
	'wss://sendit.nosflare.com',
	'wss://nostr.mom',
	'wss://nos.lol',
	'wss://relay.nostr.net',
	'wss://relay.damus.io',
	'wss://relay.minibits.cash',
]

// Keep for backward compatibility (deprecated - use DEFAULT_PUBLIC_RELAYS instead)
export const defaultRelaysUrls: string[] = DEFAULT_PUBLIC_RELAYS

// Bug reports relay - always writable even in staging
export const BUG_RELAY = 'wss://bugs.plebeian.market/'

// Default Cashu mints offered to users when creating wallets and auctions.
// Production mints only — dev/staging callers should append NIP60_DEV_TEST_MINTS
// from @/lib/stores/nip60 when wallet dev mode is enabled.
export const DEFAULT_TRUSTED_MINTS: readonly string[] = [
	'https://mint.minibits.cash/Bitcoin',
	'https://mint.coinos.io',
	'https://mint.cubabitcoin.org',
]

// Dedicated zap detection relays
export const ZAP_RELAYS = [
	'wss://relay.damus.io',
	'wss://nos.lol',
	'wss://relay.nostr.net',
	'wss://relay.minibits.cash',
	'wss://relay.coinos.io',
	'wss://nwc.primal.net',
	'wss://relay.primal.net',
]

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
	'NGN', // Nigerian Naira
] as const

/**
 * Public CEP-15 relays for the currency / auction CVM family. ONLY the
 * production CVM server publishes here; staging/dev publish only to
 * their own app relay.
 */
export const PUBLIC_CVM_RELAYS = ['wss://relay.contextvm.org', 'wss://relay2.contextvm.org'] as const

/**
 * Stage-gated public CVM relay list for the BROWSER currency client.
 *
 * The bun build inlines `process.env.NODE_ENV='production'` into the
 * browser bundle for *all* deploys (staging and prod alike), so we
 * can't distinguish them at build time. The runtime `/api/config`
 * carries the canonical stage — the caller is expected to pass it in
 * (typically read from `configStore.state.config.stage`).
 *
 *   production → `PUBLIC_CVM_RELAYS`. The prod CVM server announces
 *                there too, so global clients can hit our oracle
 *                without needing the app relay first.
 *   staging    → []. The staging CVM server announces only on
 *                `wss://relay.staging.plebeian.market`; the app relay
 *                is added separately by `getCurrencyClient`.
 *   development→ []. Local CVM server lives on the app relay
 *                (`ws://localhost:10547`).
 */
export function getCurrencyServerRelays(stage?: Stage): string[] {
	if (stage === 'production') return [...PUBLIC_CVM_RELAYS]
	return []
}

export const DEFAULT_ZAP_AMOUNTS = [
	{ displayText: '😊 21 sats', amount: 21 },
	{ displayText: '🚀 210 sats', amount: 210 },
	{ displayText: '🔥 2100 sats', amount: 2100 },
]

export const HEX_KEYS_REGEX = /^(?:[0-9a-fA-F]{64})$/
export const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export const PAYMENT_DETAILS_METHOD = {
	LIGHTNING_NETWORK: 'ln',
	// ON_CHAIN: 'on-chain',
	// CASHU: 'cashu',
	// OTHER: 'other',
} as const

export type PaymentDetailsMethod = ObjectValues<typeof PAYMENT_DETAILS_METHOD>

export { CITIES_BY_COUNTRY, COUNTRIES_ISO, COUNTRY_DIALING_CODES, type ISO3 } from '@sdk/core/geo'

export const PRODUCT_CATEGORIES = [
	'Bitcoin',
	'Art',
	'Clothing',
	'Food & Drink',
	'Home & Technology',
	'Health & Beauty',
	'Sports & Outside',
	'Services',
	'Other',
] as const

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number]

export const SHIPPING_TEMPLATES = [
	{
		name: 'Local Pickup',
		cost: '0',
		countries: [],
	},
	{
		name: 'Worldwide Standard',
		cost: '0',
		countries: null,
	},
	{
		name: 'Europe Standard',
		cost: '8.00',
		countries: [
			'AUT',
			'BEL',
			'BGR',
			'HRV',
			'CYP',
			'CZE',
			'DNK',
			'EST',
			'FIN',
			'FRA',
			'DEU',
			'GRC',
			'HUN',
			'IRL',
			'ITA',
			'LVA',
			'LTU',
			'LUX',
			'MLT',
			'NLD',
			'POL',
			'PRT',
			'ROU',
			'SVK',
			'SVN',
			'ESP',
			'SWE',
		],
	},
	{
		name: 'Digital Delivery',
		cost: '0',
		countries: null,
	},
	{
		name: 'Express Worldwide',
		cost: '0',
		countries: null,
	},
	{
		name: 'North America',
		cost: '0',
		countries: ['USA', 'CAN', 'MEX'],
	},
	{
		name: 'South America',
		cost: '0',
		countries: ['ARG', 'BOL', 'BRA', 'CHL', 'COL', 'ECU', 'GUF', 'GUY', 'PRY', 'PER', 'SUR', 'URY', 'VEN'],
	},
	{
		name: 'Asia Pacific',
		cost: '0',
		countries: ['CHN', 'JPN', 'KOR', 'TWN', 'HKG', 'SGP', 'THA', 'VNM', 'MYS', 'IDN', 'PHL', 'AUS', 'NZL'],
	},
	{
		name: 'Middle East',
		cost: '0',
		countries: ['ARE', 'SAU', 'BHR', 'OMN', 'QAT', 'KWT', 'IRN', 'IRQ', 'ISR', 'JOR', 'LBN', 'SYR'],
	},
	{
		name: 'Africa Standard',
		cost: '0',
		countries: ['ZAF', 'EGY', 'MAR', 'TUN', 'DZA', 'NGA', 'KEN', 'GHA', 'SEN', 'TZA', 'UGA', 'ETH'],
	},
	{
		name: 'UK & Ireland',
		cost: '0',
		countries: ['GBR', 'IRL'],
	},
	{
		name: 'Scandinavia',
		cost: '0',
		countries: ['DNK', 'FIN', 'ISL', 'NOR', 'SWE'],
	},
	{
		name: 'Oceania',
		cost: '0',
		countries: ['AUS', 'NZL', 'FJI', 'PNG', 'SLB', 'VUT', 'NCL', 'WSM'],
	},
	{
		name: 'DACH Region',
		cost: '0',
		countries: ['DEU', 'AUT', 'CHE'],
	},
	{
		name: 'Benelux',
		cost: '0',
		countries: ['BEL', 'NLD', 'LUX'],
	},
	{
		name: 'Mediterranean',
		cost: '0',
		countries: ['ESP', 'PRT', 'ITA', 'GRC', 'MLT', 'CYP', 'HRV', 'SVN'],
	},
]
