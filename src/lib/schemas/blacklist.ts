import { z } from 'zod'

/**
 * Schema for blacklist entries following NIP-51 mute list specification
 */
export const BlacklistEntrySchema = z.object({
	pubkey: z.string().length(64, 'Invalid pubkey length'),
	reason: z.string().optional(),
	addedBy: z.string().length(64, 'Invalid addedBy pubkey length'),
	addedAt: z.number(),
})

export type BlacklistEntry = z.infer<typeof BlacklistEntrySchema>

/**
 * Schema for complete blacklist data
 */
export const BlacklistDataSchema = z.object({
	entries: z.array(BlacklistEntrySchema),
	lastUpdated: z.number(),
})

export type BlacklistData = z.infer<typeof BlacklistDataSchema>

/**
 * Schema for blacklist settings event content
 */
export const BlacklistSettingsSchema = z.object({
	blacklistedPubkeys: z.array(z.string()),
	lastUpdated: z.number().optional(),
})

export type BlacklistSettings = z.infer<typeof BlacklistSettingsSchema>
