import { STOREFRONT_THEME_IDS, type StorefrontThemeId } from '@/lib/schemas/storefront'
import type { CSSProperties } from 'react'

/**
 * The storefront theme registry (ADR-0006 §"Theme Integration").
 *
 * A theme is a fixed set of token values for the same CSS custom property
 * names the rest of the app already styles with (`--primary`, `--card`,
 * `--background`, `--foreground`, …), applied as inline styles on
 * `StorefrontRoot`. Because every storefront block is written in token-based
 * Tailwind classes (`bg-card`, `text-primary`, …) rather than hardcoded
 * colors, a theme never has to touch component code — the browser resolves
 * the CSS custom property cascade from whichever ancestor defines it, exactly
 * as ADR-0006 describes.
 *
 * This is the only place theme values live. The schema (`storefront.ts`)
 * knows only the closed list of valid ids; it has no opinion on what a theme
 * looks like, so changing a palette here never touches a published document.
 */

export interface StorefrontThemeTokens {
	background: string
	foreground: string
	card: string
	cardForeground: string
	primary: string
	primaryForeground: string
	secondary: string
	muted: string
	mutedForeground: string
	border: string
}

export interface StorefrontThemeDefinition {
	id: StorefrontThemeId
	label: string
	description: string
	tokens: StorefrontThemeTokens
}

/**
 * Token values use the same `oklch()` format as `styles/globals-new.css`, per
 * ADR-0006's note that the app's theme files "use oklch (matching ADR-0007's
 * color standard)". `default` reuses the app's own light-mode tokens outright
 * so a page with no theme preference looks identical to the rest of the app.
 */
export const STOREFRONT_THEMES: Record<StorefrontThemeId, StorefrontThemeDefinition> = {
	default: {
		id: 'default',
		label: 'Default',
		description: 'The standard Plebeian Market look.',
		tokens: {
			background: 'oklch(1 0 0)',
			foreground: 'oklch(0.218 0 0)',
			card: 'oklch(1 0 0)',
			cardForeground: 'oklch(0.218 0 0)',
			primary: 'oklch(0.231 0 0)',
			primaryForeground: 'oklch(0.985 0 0)',
			secondary: 'oklch(0.688 0.249 348)',
			muted: 'oklch(0.961 0.005 314.8)',
			mutedForeground: 'oklch(0.45 0.01 300)',
			border: 'oklch(0.851 0.025 340.4)',
		},
	},
	midnight: {
		id: 'midnight',
		label: 'Midnight',
		description: 'Dark background, light text — good for a gallery of photos or art.',
		tokens: {
			background: 'oklch(0.135 0.005 285.8)',
			foreground: 'oklch(0.982 0 0)',
			card: 'oklch(0.18 0.008 285.8)',
			cardForeground: 'oklch(0.982 0 0)',
			primary: 'oklch(0.982 0 0)',
			primaryForeground: 'oklch(0.15 0 0)',
			secondary: 'oklch(0.274 0.006 286)',
			muted: 'oklch(0.274 0.006 286)',
			mutedForeground: 'oklch(0.7 0.01 286)',
			border: 'oklch(0.3 0.008 286)',
		},
	},
	sunset: {
		id: 'sunset',
		label: 'Sunset',
		description: 'Warm oranges and coral — friendly and casual.',
		tokens: {
			background: 'oklch(0.98 0.01 50)',
			foreground: 'oklch(0.25 0.03 30)',
			card: 'oklch(1 0.006 50)',
			cardForeground: 'oklch(0.25 0.03 30)',
			primary: 'oklch(0.62 0.19 35)',
			primaryForeground: 'oklch(0.99 0 0)',
			secondary: 'oklch(0.7 0.18 20)',
			muted: 'oklch(0.93 0.03 40)',
			mutedForeground: 'oklch(0.45 0.03 35)',
			border: 'oklch(0.85 0.05 40)',
		},
	},
	forest: {
		id: 'forest',
		label: 'Forest',
		description: 'Greens and earth tones — natural, handmade, outdoors.',
		tokens: {
			background: 'oklch(0.97 0.01 140)',
			foreground: 'oklch(0.22 0.02 150)',
			card: 'oklch(0.995 0.006 140)',
			cardForeground: 'oklch(0.22 0.02 150)',
			primary: 'oklch(0.45 0.1 150)',
			primaryForeground: 'oklch(0.98 0 0)',
			secondary: 'oklch(0.6 0.08 90)',
			muted: 'oklch(0.91 0.02 140)',
			mutedForeground: 'oklch(0.4 0.02 140)',
			border: 'oklch(0.82 0.03 140)',
		},
	},
	mono: {
		id: 'mono',
		label: 'Mono',
		description: 'Black, white, and grey — maximum contrast, no distractions.',
		tokens: {
			background: 'oklch(1 0 0)',
			foreground: 'oklch(0.12 0 0)',
			card: 'oklch(0.99 0 0)',
			cardForeground: 'oklch(0.12 0 0)',
			primary: 'oklch(0.12 0 0)',
			primaryForeground: 'oklch(0.99 0 0)',
			secondary: 'oklch(0.55 0 0)',
			muted: 'oklch(0.93 0 0)',
			mutedForeground: 'oklch(0.4 0 0)',
			border: 'oklch(0.8 0 0)',
		},
	},
}

/** `STOREFRONT_THEMES` in the schema's declared order — what pickers iterate over. */
export const STOREFRONT_THEME_LIST: StorefrontThemeDefinition[] = STOREFRONT_THEME_IDS.map((id) => STOREFRONT_THEMES[id])

/** Falls back to `default` for an id outside the closed set, rather than throwing mid-render. */
export function getStorefrontTheme(id: string | undefined): StorefrontThemeDefinition {
	if (id && Object.prototype.hasOwnProperty.call(STOREFRONT_THEMES, id)) {
		return STOREFRONT_THEMES[id as StorefrontThemeId]
	}
	return STOREFRONT_THEMES.default
}

/**
 * Projects a theme's tokens onto the standard CSS custom property names the
 * rest of the app already reads (`--primary`, `--card`, …). Applied as an
 * inline `style` on a wrapper element — the mechanism ADR-0006 specifies —
 * so the override wins at a closer DOM scope than whatever the page's
 * ancestors define, with no component-level theme awareness required.
 */
export function storefrontThemeCssVars(theme: StorefrontThemeDefinition): CSSProperties {
	return {
		'--background': theme.tokens.background,
		'--foreground': theme.tokens.foreground,
		'--card': theme.tokens.card,
		'--card-foreground': theme.tokens.cardForeground,
		'--primary': theme.tokens.primary,
		'--primary-foreground': theme.tokens.primaryForeground,
		'--secondary': theme.tokens.secondary,
		'--muted': theme.tokens.muted,
		'--muted-foreground': theme.tokens.mutedForeground,
		'--border': theme.tokens.border,
	} as CSSProperties
}

/** The five swatch dots a picker shows for one theme — enough to read its vibe at a glance. */
export function storefrontThemeSwatchColors(theme: StorefrontThemeDefinition): string[] {
	return [theme.tokens.background, theme.tokens.primary, theme.tokens.secondary, theme.tokens.muted, theme.tokens.foreground]
}
