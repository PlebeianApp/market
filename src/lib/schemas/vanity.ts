import { z } from 'zod'
import type { NDKKind } from '@nostr-dev-kit/ndk'

// ===============================
// Vanity URL Event Kinds
// ===============================

export const VANITY_CONFIG_KIND = 30408 as NDKKind
export const VANITY_REQUEST_KIND = 30409 as NDKKind
export const VANITY_CONFIRMATION_KIND = 30410 as NDKKind

// ===============================
// Vanity Config (Kind: 30408)
// Published by app operator to configure pricing
// ===============================

const VanityConfigDTagSchema = z.tuple([z.literal('d'), z.string()]) // domain
const VanityConfigLud16TagSchema = z.tuple([z.literal('lud16'), z.string()])
const VanityConfigPriceTagSchema = z.tuple([z.literal('price'), z.string().regex(/^\d+$/, 'Must be an integer')])
const VanityConfigDurationTagSchema = z.tuple([z.literal('duration'), z.string().regex(/^\d+$/, 'Must be an integer')])

export const VanityConfigSchema = z.object({
	kind: z.literal(VANITY_CONFIG_KIND),
	created_at: z.number().int().positive(),
	content: z.string(),
	tags: z
		.array(
			z.union([
				VanityConfigDTagSchema,
				VanityConfigLud16TagSchema,
				VanityConfigPriceTagSchema,
				VanityConfigDurationTagSchema,
				z.array(z.string()),
			]),
		)
		.refine(
			(tags) => {
				return tags.some((tag) => tag[0] === 'd') && tags.some((tag) => tag[0] === 'lud16')
			},
			{ message: 'Missing required tags: d, lud16' },
		),
})

export type VanityConfigEvent = z.infer<typeof VanityConfigSchema>

// ===============================
// Vanity Request (Kind: 30409)
// Published by user to request a vanity name
// ===============================

// d-tag format: <name>:<domain>
const VanityRequestDTagSchema = z.tuple([z.literal('d'), z.string().regex(/^[a-z0-9_-]+:[a-z0-9.-]+$/, 'Must be in format name:domain')])
const VanityRequestNameTagSchema = z.tuple([
	z.literal('name'),
	z.string().regex(/^[a-z0-9_-]+$/, 'Must be lowercase alphanumeric with hyphens/underscores'),
])
const VanityRequestDomainTagSchema = z.tuple([z.literal('domain'), z.string()])

export const VanityRequestSchema = z.object({
	kind: z.literal(VANITY_REQUEST_KIND),
	created_at: z.number().int().positive(),
	content: z.string(),
	tags: z.array(z.union([VanityRequestDTagSchema, VanityRequestNameTagSchema, VanityRequestDomainTagSchema, z.array(z.string())])).refine(
		(tags) => {
			return tags.some((tag) => tag[0] === 'd') && tags.some((tag) => tag[0] === 'name') && tags.some((tag) => tag[0] === 'domain')
		},
		{ message: 'Missing required tags: d, name, domain' },
	),
})

export type VanityRequestEvent = z.infer<typeof VanityRequestSchema>

// ===============================
// Vanity Confirmation (Kind: 30410)
// Published by app server to confirm registration
// ===============================

const VanityConfirmationDTagSchema = z.tuple([
	z.literal('d'),
	z.string().regex(/^[a-z0-9_-]+:[a-z0-9.-]+$/, 'Must be in format name:domain'),
])
const VanityConfirmationPTagSchema = z.tuple([z.literal('p'), z.string().length(64, 'Must be a 64-char hex pubkey')])
const VanityConfirmationETagSchema = z.tuple([z.literal('e'), z.string().length(64, 'Must be a 64-char hex event ID')])
const VanityConfirmationNameTagSchema = z.tuple([z.literal('name'), z.string()])
const VanityConfirmationDomainTagSchema = z.tuple([z.literal('domain'), z.string()])
const VanityConfirmationValidUntilTagSchema = z.tuple([z.literal('valid_until'), z.string().regex(/^\d+$/, 'Must be a unix timestamp')])
const VanityConfirmationPaymentHashTagSchema = z.tuple([z.literal('payment_hash'), z.string()])
const VanityConfirmationRevokedTagSchema = z.tuple([z.literal('revoked'), z.string().regex(/^\d+$/, 'Must be a unix timestamp')])

export const VanityConfirmationSchema = z.object({
	kind: z.literal(VANITY_CONFIRMATION_KIND),
	created_at: z.number().int().positive(),
	content: z.string(),
	tags: z
		.array(
			z.union([
				VanityConfirmationDTagSchema,
				VanityConfirmationPTagSchema,
				VanityConfirmationETagSchema,
				VanityConfirmationNameTagSchema,
				VanityConfirmationDomainTagSchema,
				VanityConfirmationValidUntilTagSchema,
				VanityConfirmationPaymentHashTagSchema,
				VanityConfirmationRevokedTagSchema,
				z.array(z.string()),
			]),
		)
		.refine(
			(tags) => {
				const hasD = tags.some((tag) => tag[0] === 'd')
				const hasName = tags.some((tag) => tag[0] === 'name')
				const hasDomain = tags.some((tag) => tag[0] === 'domain')
				// Revoked events don't need p, e, valid_until
				const isRevoked = tags.some((tag) => tag[0] === 'revoked')
				if (isRevoked) {
					return hasD && hasName && hasDomain
				}
				const hasP = tags.some((tag) => tag[0] === 'p')
				const hasE = tags.some((tag) => tag[0] === 'e')
				const hasValidUntil = tags.some((tag) => tag[0] === 'valid_until')
				return hasD && hasP && hasE && hasName && hasDomain && hasValidUntil
			},
			{ message: 'Missing required tags for vanity confirmation' },
		),
})

export type VanityConfirmationEvent = z.infer<typeof VanityConfirmationSchema>

// ===============================
// Parsed Types for UI
// ===============================

export interface VanityConfig {
	domain: string
	lud16: string
	price: number // in sats
	duration: number // in seconds
}

export interface VanityRequest {
	eventId: string
	pubkey: string
	name: string
	domain: string
	dTag: string
	createdAt: number
}

export interface VanityConfirmation {
	eventId: string
	userPubkey: string
	name: string
	domain: string
	dTag: string
	validUntil: number
	paymentHash: string
	revoked: boolean
	revokedAt?: number
	createdAt: number
}

export type VanityStatus = 'available' | 'pending_payment' | 'pending_confirmation' | 'active' | 'expired' | 'revoked'

export interface VanityAddress {
	name: string
	domain: string
	dTag: string
	status: VanityStatus
	request?: VanityRequest
	confirmation?: VanityConfirmation
	isDeleted: boolean
}

// ===============================
// Helper Functions
// ===============================

export function generateVanityDTag(name: string, domain: string): string {
	return `${name.toLowerCase()}:${domain}`
}

export function parseVanityDTag(dTag: string): { name: string; domain: string } | null {
	const parts = dTag.split(':')
	if (parts.length !== 2) return null
	return { name: parts[0], domain: parts[1] }
}

export function isVanityExpired(validUntil: number): boolean {
	return Date.now() / 1000 > validUntil
}

// Reserved names that cannot be registered
export const VANITY_RESERVED_NAMES = new Set([
	'admin',
	'api',
	'help',
	'support',
	'status',
	'docs',
	'blog',
	'settings',
	'dashboard',
	'login',
	'logout',
	'signup',
	'product',
	'products',
	'collection',
	'user',
	'profile',
	'search',
	'checkout',
	'cart',
	'p',
	'c',
	'assets',
	'static',
	'favicon',
])

export function isValidVanityName(name: string): boolean {
	if (!name || name.length > 64) return false
	if (VANITY_RESERVED_NAMES.has(name.toLowerCase())) return false
	return /^[a-z0-9][a-z0-9_-]*$/.test(name.toLowerCase())
}
