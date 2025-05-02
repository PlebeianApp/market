export const defaultRelaysUrls: string[] = ['wss://relay.nostr.band', 'wss://nos.lol', 'wss://relay.nostr.net', 'wss://relay.damus.io']

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
