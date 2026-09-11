import { z } from 'zod'

export const WebUrlSchema = z
	.string()
	.url()
	.refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), 'Must use HTTP or HTTPS')
export const RelayUrlSchema = z
	.string()
	.url()
	.refine((value) => ['ws:', 'wss:'].includes(new URL(value).protocol), 'Must use WS or WSS')

export const SocialLinksSchema = z.object({
	twitter: WebUrlSchema.optional(),
	newsletter: WebUrlSchema.optional(),
	telegram: WebUrlSchema.optional(),
	github: WebUrlSchema.optional(),
	nostr: WebUrlSchema.optional(),
})

export const AppSettingsSchema = z.object({
	name: z.string(),
	displayName: z.string(),
	picture: z.string().url(),
	banner: z.string().url(),
	ownerPk: z.string(),
	allowRegister: z.boolean(),
	defaultCurrency: z.string(),
	contactEmail: z
		.string()
		.optional()
		.transform((val) => val || undefined),
	blossom_server: z.string().url().optional(),
	nip96_server: z.string().url().optional(),
	showNostrLink: z.boolean().optional().default(false),
	handlerId: z.string().min(1).optional(),
	siteUrl: WebUrlSchema.optional(),
	publicRelays: z.array(RelayUrlSchema).optional(),
	trustedMints: z.array(WebUrlSchema).optional(),
	bugRelay: RelayUrlSchema.optional(),
	termsUrl: WebUrlSchema.optional(),
	socialLinks: SocialLinksSchema.optional(),
	supportContact: z.string().min(1).optional(),
})

export const ExtendedSettingsSchema = z.object({
	extended_field: z.string().optional(),
})

export type AppSettings = z.infer<typeof AppSettingsSchema>
export type SocialLinks = z.infer<typeof SocialLinksSchema>
export type ExtendedSettings = z.infer<typeof ExtendedSettingsSchema>
