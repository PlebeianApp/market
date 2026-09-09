import { z } from 'zod'
import { BUG_RELAY, DEFAULT_PUBLIC_RELAYS, DEFAULT_TRUSTED_MINTS, type Stage } from './constants'
import { RelayUrlSchema, SocialLinksSchema, WebUrlSchema, type AppSettings, type SocialLinks } from './schemas/app'

export interface InstanceConfig {
	name: string
	displayName: string
	picture: string
	banner: string
	ownerPk?: string
	allowRegister: boolean
	defaultCurrency: string
	contactEmail?: string
	blossomServer?: string
	nip96Server?: string
	showNostrLink: boolean
	handlerId: string
	siteUrl: string
	publicRelays: string[]
	trustedMints: string[]
	bugRelay: string
	termsUrl?: string
	socialLinks: SocialLinks
	supportContact?: string
}

export type InstanceConfigEnvironment = Partial<InstanceConfig>

export interface PublicAppConfig extends InstanceConfig {
	appRelay: string
	stage: Stage
	nip46Relay: string
	appSettings: AppSettings | null
	appPublicKey: string
	cvmServerPubkey?: string
	needsSetup: boolean
	serverReady: boolean
	externalZapRelaysEnabled: boolean
}

const InstanceConfigEnvironmentSchema = z.object({
	name: z.string().min(1).optional(),
	displayName: z.string().min(1).optional(),
	picture: WebUrlSchema.optional(),
	banner: WebUrlSchema.optional(),
	ownerPk: z
		.string()
		.regex(/^[0-9a-fA-F]{64}$/)
		.optional(),
	allowRegister: z.boolean().optional(),
	defaultCurrency: z.string().min(1).optional(),
	contactEmail: z.string().min(1).optional(),
	blossomServer: WebUrlSchema.optional(),
	nip96Server: WebUrlSchema.optional(),
	showNostrLink: z.boolean().optional(),
	handlerId: z.string().min(1).optional(),
	siteUrl: WebUrlSchema.optional(),
	publicRelays: z.array(RelayUrlSchema).optional(),
	trustedMints: z.array(WebUrlSchema).optional(),
	bugRelay: RelayUrlSchema.optional(),
	termsUrl: WebUrlSchema.optional(),
	socialLinks: SocialLinksSchema.optional(),
	supportContact: z.string().min(1).optional(),
})

export const DEFAULT_INSTANCE_CONFIG: InstanceConfig = {
	name: 'Plebeian Market',
	displayName: 'Plebeian Market',
	picture: 'https://plebeian.market/images/logo.svg',
	banner: 'https://plebeian.market/banner.png',
	allowRegister: true,
	defaultCurrency: 'USD',
	showNostrLink: false,
	handlerId: 'plebeian-market-handler',
	siteUrl: 'https://plebeian.market',
	publicRelays: [...DEFAULT_PUBLIC_RELAYS],
	trustedMints: [...DEFAULT_TRUSTED_MINTS],
	bugRelay: BUG_RELAY,
	socialLinks: {
		twitter: 'https://twitter.com/PlebeianMarket',
		newsletter: 'https://plebeianmarket.substack.com/',
		telegram: 'https://t.me/PlebeianMarket',
		github: 'https://github.com/PlebeianApp/market',
	},
}

function defined<T>(value: T | null | undefined): value is T {
	return value !== undefined && value !== null
}

function optionalList(value: string | undefined): string[] | undefined {
	if (!value?.trim()) return undefined
	return value
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean)
}

function optionalBoolean(value: string | undefined): boolean | undefined {
	if (!value?.trim()) return undefined
	if (value === 'true') return true
	if (value === 'false') return false
	throw new Error(`Expected "true" or "false", received "${value}"`)
}

export function parseInstanceConfigEnvironment(environment: Record<string, string | undefined>): InstanceConfigEnvironment {
	const socialLinks = {
		twitter: environment.INSTANCE_TWITTER_URL,
		newsletter: environment.INSTANCE_NEWSLETTER_URL,
		telegram: environment.INSTANCE_TELEGRAM_URL,
		github: environment.INSTANCE_GITHUB_URL,
	}
	const hasSocialLinks = Object.values(socialLinks).some(defined)

	return InstanceConfigEnvironmentSchema.parse({
		name: environment.INSTANCE_NAME,
		displayName: environment.INSTANCE_DISPLAY_NAME,
		picture: environment.INSTANCE_PICTURE_URL,
		banner: environment.INSTANCE_BANNER_URL,
		ownerPk: environment.INSTANCE_OWNER_PUBKEY,
		allowRegister: optionalBoolean(environment.INSTANCE_ALLOW_REGISTER),
		defaultCurrency: environment.INSTANCE_DEFAULT_CURRENCY,
		contactEmail: environment.INSTANCE_CONTACT_EMAIL,
		blossomServer: environment.BLOSSOM_SERVER,
		nip96Server: environment.NIP96_SERVER,
		showNostrLink: optionalBoolean(environment.INSTANCE_SHOW_NOSTR_LINK),
		handlerId: environment.INSTANCE_HANDLER_ID,
		siteUrl: environment.INSTANCE_SITE_URL,
		publicRelays: optionalList(environment.INSTANCE_PUBLIC_RELAYS),
		trustedMints: optionalList(environment.INSTANCE_TRUSTED_MINTS),
		bugRelay: environment.INSTANCE_BUG_RELAY,
		termsUrl: environment.INSTANCE_TERMS_URL,
		socialLinks: hasSocialLinks ? socialLinks : undefined,
		supportContact: environment.INSTANCE_SUPPORT_CONTACT,
	})
}

export function resolveInstanceConfig(appSettings: AppSettings | null, environment: InstanceConfigEnvironment = {}): InstanceConfig {
	const validatedEnvironment = InstanceConfigEnvironmentSchema.parse(environment)
	const eventValues: Partial<InstanceConfig> = appSettings
		? {
				name: appSettings.name,
				displayName: appSettings.displayName,
				picture: appSettings.picture,
				banner: appSettings.banner,
				ownerPk: appSettings.ownerPk,
				allowRegister: appSettings.allowRegister,
				defaultCurrency: appSettings.defaultCurrency,
				contactEmail: appSettings.contactEmail,
				blossomServer: appSettings.blossom_server,
				nip96Server: appSettings.nip96_server,
				showNostrLink: appSettings.showNostrLink,
				handlerId: appSettings.handlerId,
				siteUrl: appSettings.siteUrl,
				publicRelays: appSettings.publicRelays,
				trustedMints: appSettings.trustedMints,
				bugRelay: appSettings.bugRelay,
				termsUrl: appSettings.termsUrl,
				socialLinks: appSettings.socialLinks,
				supportContact: appSettings.supportContact,
			}
		: {}

	const resolved = { ...DEFAULT_INSTANCE_CONFIG }
	for (const [key, value] of Object.entries(validatedEnvironment)) {
		if (defined(value)) Object.assign(resolved, { [key]: value })
	}
	for (const [key, value] of Object.entries(eventValues)) {
		if (defined(value)) Object.assign(resolved, { [key]: value })
	}

	return {
		...resolved,
		publicRelays: [...resolved.publicRelays],
		trustedMints: [...resolved.trustedMints],
		socialLinks: { ...resolved.socialLinks },
	}
}
