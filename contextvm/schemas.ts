import { z } from 'zod'

export const getBtcPriceInputSchema = {
	refresh: z.boolean().optional().default(false).describe('Force refresh of rates, bypassing the server cache'),
}

export const getBtcPriceOutputSchema = {
	rates: z.record(z.string(), z.number()).describe('BTC exchange rates per fiat currency'),
	sourcesSucceeded: z.array(z.string()).describe('Price sources that returned successfully'),
	sourcesFailed: z.array(z.string()).describe('Price sources that failed'),
	fetchedAt: z.number().describe('Unix timestamp (ms) when rates were fetched'),
	cached: z.boolean().describe('Whether the returned rates were served from cache'),
}

export const getBtcPriceSingleInputSchema = {
	currency: z.string().describe('ISO 4217 currency code, e.g. USD, EUR, JPY'),
	refresh: z.boolean().optional().default(false).describe('Force refresh of rates, bypassing the server cache'),
}

export const getBtcPriceSingleOutputSchema = {
	currency: z.string().describe('The requested currency code'),
	rate: z.number().describe('BTC exchange rate for the requested currency'),
	fetchedAt: z.number().describe('Unix timestamp (ms) when rates were fetched'),
	cached: z.boolean().describe('Whether the returned rate was served from cache'),
}

export const walletStateSyncInputSchema = {
	pubkey: z.string().min(1).describe('The wallet owner pubkey (hex) whose state is being synced'),
	encryptedState: z.string().min(1).describe('NIP-44 encrypted wallet state snapshot (unspent proofs + derivation counter + heap pointer)'),
	sequence: z.number().int().nonnegative().describe('Monotonic sequence counter for ordering (UX only, not correctness)'),
	version: z.number().int().nonnegative().optional().describe('Client-known version for optimistic concurrency; server rejects stale writes'),
}

export const walletStateSyncOutputSchema = {
	pubkey: z.string().describe('The wallet owner pubkey the state was stored for'),
	version: z.number().int().nonnegative().describe('New version number assigned to the stored snapshot'),
	storedAt: z.number().describe('Unix timestamp (ms) when the snapshot was stored'),
	accepted: z.boolean().describe('Whether the snapshot was accepted and stored'),
}

export const walletStateRequestInputSchema = {
	pubkey: z.string().min(1).describe('The wallet owner pubkey (hex) whose latest state snapshot is requested'),
}

export const walletStateRequestOutputSchema = {
	pubkey: z.string().describe('The wallet owner pubkey the state was requested for'),
	found: z.boolean().describe('Whether a stored snapshot exists for the pubkey'),
	encryptedState: z.string().nullable().describe('NIP-44 encrypted wallet state snapshot, or null if none stored'),
	version: z.number().int().nonnegative().nullable().describe('Version of the stored snapshot, or null if none stored'),
	sequence: z.number().int().nonnegative().nullable().describe('Sequence counter of the stored snapshot, or null if none stored'),
	storedAt: z.number().nullable().describe('Unix timestamp (ms) the snapshot was stored, or null if none stored'),
}
