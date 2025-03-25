import { z } from 'zod'

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
})

export const ExtendedSettingsSchema = z.object({
	extended_field: z.string().optional(),
})

export type AppSettings = z.infer<typeof AppSettingsSchema>
export type ExtendedSettings = z.infer<typeof ExtendedSettingsSchema>
