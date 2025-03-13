import { z } from 'zod'

export const AppSettingsSchema = z.object({
	name: z.string(),
	displayName: z.string(),
	picture: z.string().url(),
	banner: z.string().url(),
	ownerPk: z.string(),
	allowRegister: z.boolean(),
	defaultCurrency: z.string(),
	blossom_server: z.string().url().optional(),
	nip96_server: z.string().url().optional(),
})

export const ExtendedSettingsSchema = z.object({
	extended_field: z.string(),
	field_to_encrypt: z.string(),
})

export const BanListSchema = z.object({
	pubkeys: z.array(z.string()),
	words: z.array(z.string()),
	hashtags: z.array(z.string()),
})

export const UserRolesSchema = z.object({
	roles: z.object({
		admins: z.array(z.string()),
		editors: z.array(z.string()),
		plebs: z.array(z.string()),
	}),
})

export type AppSettings = z.infer<typeof AppSettingsSchema>
export type ExtendedSettings = z.infer<typeof ExtendedSettingsSchema>
export type BanList = z.infer<typeof BanListSchema>
export type UserRoles = z.infer<typeof UserRolesSchema>
