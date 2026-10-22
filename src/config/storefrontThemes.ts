import { STOREFRONT_THEME_IDS, type StorefrontPaletteKey, type StorefrontThemeId } from '@/lib/schemas/storefront'
import type { CSSProperties } from 'react'

/**
 * The storefront theme registry (ADR-0006 §"Theme Integration").
 *
 * A theme is a curated set of token values for the same CSS custom property
 * names the rest of the app already styles with (`--primary`, `--card`,
 * `--background`, `--foreground`, …), applied as inline styles on
 * `StorefrontRoot`. Because every storefront block is written in token-based
 * Tailwind classes (`bg-card`, `text-primary`, …) rather than hardcoded
 * colors, a theme never has to touch component code — the browser resolves
 * the CSS custom property cascade from whichever ancestor defines it, exactly
 * as ADR-0006 describes.
 *
 * Provenance: the eight `farm`…`brut` layouts, their palettes and their default
 * tune values are transcribed from the Plebeian Theme Studio proof of concept
 * (https://plebeian-theme-studio.pplx.app), which ships the same model as
 * `window.THEMES` in plain JS. The studio's nine palette tokens are converted
 * here to the ten this app already reads; see `toAppTokens` notes below. The
 * five `default`…`mono` entries predate that and are kept unchanged so pages
 * published against them keep validating and keep rendering identically.
 *
 * Security: nothing in this file is author-controlled. A published page names a
 * *layout id* and a *palette key*, both of which are closed sets declared in
 * `src/lib/schemas/storefront.ts`, plus six *bounded numbers*. Every value that
 * reaches the DOM is either a string from this file or a number clamped to a
 * declared range — never CSS the author wrote. The studio itself never offers a
 * free colour picker either, which is why its model can be adopted wholesale.
 *
 * This is the only place theme values live. The schema knows only the closed
 * lists of valid ids and the tune bounds; it has no opinion on what a theme
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

/**
 * One curated colourway. `swatch` holds the three hex dots the picker shows;
 * those are display-only and never applied to the page. `shadowRgb` is a bare
 * `r,g,b` triple rather than a colour, matching the studio: a shadow takes its
 * hue from the palette instead of being neutral black.
 */
export interface StorefrontThemePalette {
	key: StorefrontPaletteKey
	label: string
	dark: boolean
	/** Part of the studio's shared pair (Brutalist, Neon), offered on most layouts. */
	shared: boolean
	swatch: string[]
	shadowRgb: string
	tokens: StorefrontThemeTokens
}

/** The six "human touch" axes, mirroring the studio's `CTLS`. All bounded. */
export interface StorefrontThemeTune {
	/** 0–32 px. */
	radiusPx: number
	/** 0–1 shadow strength. */
	shadow: number
	/** 0–1 backdrop blur / surface alpha. */
	glass: number
	/** 0.75–1.45 spacing multiplier. */
	spacing: number
	/** 0–1 paper-grain overlay opacity. */
	texture: number
	/** 0–1 tilt and uneven-corner amount. */
	handmade: number
}

export interface StorefrontThemeDefinition {
	id: StorefrontThemeId
	label: string
	description: string
	/** Who the layout was designed for, from the studio's `for` field. */
	forWho: string
	/** The studio's type pairing, as a display string. */
	fonts: string
	/** Default tune for this layout — what "Reset" returns to. */
	tune: StorefrontThemeTune
	palettes: StorefrontThemePalette[]
	/**
	 * The layout's default palette tokens. Kept as a top-level field because the
	 * render path and the older registry tests read `theme.tokens` directly; it
	 * is always `palettes[0].tokens`.
	 */
	tokens: StorefrontThemeTokens
}

/** A raw registry entry, before the default palette is projected onto `tokens`. */
type StorefrontThemeData = Omit<StorefrontThemeDefinition, 'tokens'>

export const STOREFRONT_DEFAULT_TUNE: StorefrontThemeTune = {
	radiusPx: 12,
	shadow: 0.3,
	glass: 0.6,
	spacing: 1,
	texture: 0,
	handmade: 0,
}

/**
 * The six tune axes as data, so the picker renders sliders from the same
 * declaration the schema validates against. `words` label the value bands,
 * exactly as the studio's panel does ("Sharp … Pebble").
 */
export interface StorefrontTuneAxis {
	key: keyof StorefrontThemeTune
	label: string
	min: number
	max: number
	step: number
	ends: [string, string]
	words: string[]
}

export const STOREFRONT_TUNE_AXES: StorefrontTuneAxis[] = [
	{
		key: 'radiusPx',
		label: 'Corners',
		min: 0,
		max: 32,
		step: 1,
		ends: ['Sharp', 'Round'],
		words: ['Sharp', 'Crisp', 'Soft', 'Round', 'Pebble'],
	},
	{
		key: 'shadow',
		label: 'Shadows',
		min: 0,
		max: 1,
		step: 0.01,
		ends: ['Flat', 'Deep'],
		words: ['Flat', 'Subtle', 'Lifted', 'Floating', 'Dramatic'],
	},
	{
		key: 'glass',
		label: 'Glass',
		min: 0,
		max: 1,
		step: 0.01,
		ends: ['Solid', 'Frosted'],
		words: ['Solid', 'Hint', 'Frosted', 'Airy', 'Clear'],
	},
	{
		key: 'spacing',
		label: 'Spacing',
		min: 0.75,
		max: 1.45,
		step: 0.01,
		ends: ['Snug', 'Airy'],
		words: ['Snug', 'Tidy', 'Balanced', 'Roomy', 'Airy'],
	},
	{
		key: 'texture',
		label: 'Texture',
		min: 0,
		max: 1,
		step: 0.01,
		ends: ['Clean', 'Paper'],
		words: ['Clean', 'Faint', 'Matte', 'Paper', 'Risograph'],
	},
	{
		key: 'handmade',
		label: 'Hand-made',
		min: 0,
		max: 1,
		step: 0.01,
		ends: ['Precise', 'Hand-cut'],
		words: ['Precise', 'Relaxed', 'Crafted', 'Hand-cut', 'Wonky'],
	},
]

/** The word a slider shows for its current value. Mirrors the studio's `word()`. */
export function storefrontTuneWord(axis: StorefrontTuneAxis, value: number): string {
	const frac = (value - axis.min) / (axis.max - axis.min)
	const index = Math.min(axis.words.length - 1, Math.max(0, Math.floor(frac * axis.words.length)))
	return axis.words[index]
}

/** Clamps a partial or hostile tune object into the declared bounds. */
export function normalizeStorefrontTune(
	tune: Partial<StorefrontThemeTune> | undefined,
	fallback: StorefrontThemeTune = STOREFRONT_DEFAULT_TUNE,
): StorefrontThemeTune {
	const out = { ...fallback }
	for (const axis of STOREFRONT_TUNE_AXES) {
		const raw = tune?.[axis.key]
		if (typeof raw !== 'number' || !Number.isFinite(raw)) continue
		const clamped = Math.min(axis.max, Math.max(axis.min, raw))
		out[axis.key] = axis.step === 1 ? Math.round(clamped) : Number(clamped.toFixed(2))
	}
	return out
}

const THEME_DATA: Record<string, StorefrontThemeData> = {
	default: {
		id: 'default',
		label: 'Default',
		description: 'The standard market look.',
		forWho: 'Every seller',
		fonts: 'App default',
		tune: STOREFRONT_DEFAULT_TUNE,
		palettes: [
			{
				key: 'default',
				label: 'Default',
				dark: false,
				shared: false,
				swatch: ['oklch(1 0 0)', 'oklch(0.231 0 0)', 'oklch(0.688 0.249 348)'],
				shadowRgb: '20,20,20',
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
		],
	},
	midnight: {
		id: 'midnight',
		label: 'Midnight',
		description: 'Dark background, light text \u2014 good for a gallery of photos or art.',
		forWho: 'Night owls',
		fonts: 'App default',
		tune: STOREFRONT_DEFAULT_TUNE,
		palettes: [
			{
				key: 'midnight',
				label: 'Midnight',
				dark: true,
				shared: false,
				swatch: ['oklch(0.135 0.005 285.8)', 'oklch(0.982 0 0)', 'oklch(0.274 0.006 286)'],
				shadowRgb: '20,20,20',
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
		],
	},
	sunset: {
		id: 'sunset',
		label: 'Sunset',
		description: 'Warm oranges and coral \u2014 friendly and casual.',
		forWho: 'Casual sellers',
		fonts: 'App default',
		tune: STOREFRONT_DEFAULT_TUNE,
		palettes: [
			{
				key: 'sunset',
				label: 'Sunset',
				dark: false,
				shared: false,
				swatch: ['oklch(0.98 0.01 50)', 'oklch(0.62 0.19 35)', 'oklch(0.7 0.18 20)'],
				shadowRgb: '20,20,20',
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
		],
	},
	forest: {
		id: 'forest',
		label: 'Forest',
		description: 'Greens and earth tones \u2014 natural, handmade, outdoors.',
		forWho: 'Makers',
		fonts: 'App default',
		tune: STOREFRONT_DEFAULT_TUNE,
		palettes: [
			{
				key: 'forest',
				label: 'Forest',
				dark: false,
				shared: false,
				swatch: ['oklch(0.97 0.01 140)', 'oklch(0.45 0.1 150)', 'oklch(0.6 0.08 90)'],
				shadowRgb: '20,20,20',
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
		],
	},
	mono: {
		id: 'mono',
		label: 'Mono',
		description: 'Black, white, and grey \u2014 maximum contrast, no distractions.',
		forWho: 'Minimalists',
		fonts: 'App default',
		tune: STOREFRONT_DEFAULT_TUNE,
		palettes: [
			{
				key: 'mono',
				label: 'Mono',
				dark: false,
				shared: false,
				swatch: ['oklch(1 0 0)', 'oklch(0.12 0 0)', 'oklch(0.55 0 0)'],
				shadowRgb: '20,20,20',
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
		],
	},
	farm: {
		id: 'farm',
		label: 'Hedgerow',
		description: 'A market-stall noticeboard. Paper price tags, a weekly harvest board, veg-box crates and a seasonal calendar.',
		forWho: 'Organic farmer',
		fonts: 'Zodiak \u00b7 Switzer \u00b7 Kalam',
		tune: { radiusPx: 14, shadow: 0.35, glass: 0.55, spacing: 1.1, texture: 0.5, handmade: 0.6 },
		palettes: [
			{
				key: 'sage-cream',
				label: 'Sage & cream',
				dark: false,
				shared: false,
				swatch: ['#f3eee2', '#3f5a3a', '#c8692f'],
				shadowRgb: '60,50,30',
				tokens: {
					background: 'oklch(0.950 0.017 88.0)',
					foreground: 'oklch(0.293 0.034 136.7)',
					card: 'oklch(0.979 0.011 89.7)',
					cardForeground: 'oklch(0.293 0.034 136.7)',
					primary: 'oklch(0.437 0.061 140.6)',
					primaryForeground: 'oklch(0.979 0.011 89.7)',
					secondary: 'oklch(0.622 0.140 49.0)',
					muted: 'oklch(0.909 0.023 87.8)',
					mutedForeground: 'oklch(0.531 0.033 129.2)',
					border: 'oklch(0.859 0.030 87.6)',
				},
			},
			{
				key: 'beetroot',
				label: 'Beetroot',
				dark: false,
				shared: false,
				swatch: ['#f6ece8', '#7a1f3d', '#5f7d3a'],
				shadowRgb: '70,20,35',
				tokens: {
					background: 'oklch(0.950 0.012 43.3)',
					foreground: 'oklch(0.238 0.042 354.3)',
					card: 'oklch(0.988 0.007 53.4)',
					cardForeground: 'oklch(0.238 0.042 354.3)',
					primary: 'oklch(0.396 0.127 5.2)',
					primaryForeground: 'oklch(0.981 0.010 48.6)',
					secondary: 'oklch(0.550 0.101 129.2)',
					muted: 'oklch(0.914 0.019 41.1)',
					mutedForeground: 'oklch(0.513 0.038 359.6)',
					border: 'oklch(0.871 0.027 38.5)',
				},
			},
			{
				key: 'harvest-gold',
				label: 'Harvest gold',
				dark: false,
				shared: false,
				swatch: ['#f7efd6', '#8a5a12', '#2f4f4f'],
				shadowRgb: '90,60,10',
				tokens: {
					background: 'oklch(0.952 0.034 92.3)',
					foreground: 'oklch(0.264 0.035 88.2)',
					card: 'oklch(0.985 0.022 92.5)',
					cardForeground: 'oklch(0.264 0.035 88.2)',
					primary: 'oklch(0.509 0.103 70.8)',
					primaryForeground: 'oklch(0.985 0.022 92.5)',
					secondary: 'oklch(0.403 0.038 195.8)',
					muted: 'oklch(0.916 0.047 91.8)',
					mutedForeground: 'oklch(0.530 0.057 87.1)',
					border: 'oklch(0.872 0.063 91.1)',
				},
			},
			{
				key: 'night-loam',
				label: 'Night loam',
				dark: true,
				shared: false,
				swatch: ['#1d1f19', '#a7c48a', '#e09a5b'],
				shadowRgb: '0,0,0',
				tokens: {
					background: 'oklch(0.235 0.012 122.3)',
					foreground: 'oklch(0.925 0.022 92.5)',
					card: 'oklch(0.279 0.015 124.1)',
					cardForeground: 'oklch(0.925 0.022 92.5)',
					primary: 'oklch(0.784 0.085 129.8)',
					primaryForeground: 'oklch(0.235 0.012 122.3)',
					secondary: 'oklch(0.742 0.116 61.5)',
					muted: 'oklch(0.288 0.014 121.7)',
					mutedForeground: 'oklch(0.703 0.024 98.8)',
					border: 'oklch(0.354 0.017 120.9)',
				},
			},
			{
				key: 'brutal',
				label: 'Brutalist',
				dark: false,
				shared: true,
				swatch: ['#ffffff', '#000000', '#ff3d00'],
				shadowRgb: '0,0,0',
				tokens: {
					background: 'oklch(1.000 0.000 89.9)',
					foreground: 'oklch(0.000 0.000 0.0)',
					card: 'oklch(1.000 0.000 89.9)',
					cardForeground: 'oklch(0.000 0.000 0.0)',
					primary: 'oklch(0.654 0.235 34.0)',
					primaryForeground: 'oklch(0.000 0.000 0.0)',
					secondary: 'oklch(0.452 0.313 264.1)',
					muted: 'oklch(0.550 0.000 49.4)',
					mutedForeground: 'oklch(0.289 0.000 89.9)',
					border: 'oklch(0.000 0.000 0.0)',
				},
			},
			{
				key: 'neon',
				label: 'Neon',
				dark: true,
				shared: true,
				swatch: ['#07070c', '#39ff14', '#ff2bd6'],
				shadowRgb: '0,0,0',
				tokens: {
					background: 'oklch(0.131 0.012 284.7)',
					foreground: 'oklch(0.970 0.015 286.1)',
					card: 'oklch(0.183 0.020 284.2)',
					cardForeground: 'oklch(0.970 0.015 286.1)',
					primary: 'oklch(0.871 0.286 141.5)',
					primaryForeground: 'oklch(0.131 0.012 284.7)',
					secondary: 'oklch(0.691 0.282 338.1)',
					muted: 'oklch(0.198 0.025 284.1)',
					mutedForeground: 'oklch(0.696 0.044 285.2)',
					border: 'oklch(0.280 0.042 283.3)',
				},
			},
		],
	},
	art: {
		id: 'art',
		label: 'Salon',
		description: 'A quiet gallery wall. Works hung at different sizes, red-dot sold markers, and a live auction lot with countdown.',
		forWho: 'Artist portfolio',
		fonts: 'Boska \u00b7 Switzer',
		tune: { radiusPx: 0, shadow: 0.12, glass: 0.25, spacing: 1.3, texture: 0.1, handmade: 0 },
		palettes: [
			{
				key: 'white-cube',
				label: 'White cube',
				dark: false,
				shared: false,
				swatch: ['#fbfbf9', '#141414', '#c8102e'],
				shadowRgb: '20,20,20',
				tokens: {
					background: 'oklch(0.988 0.003 106.4)',
					foreground: 'oklch(0.191 0.000 89.9)',
					card: 'oklch(1.000 0.000 89.9)',
					cardForeground: 'oklch(0.191 0.000 89.9)',
					primary: 'oklch(0.191 0.000 89.9)',
					primaryForeground: 'oklch(1.000 0.000 89.9)',
					secondary: 'oklch(0.530 0.207 22.3)',
					muted: 'oklch(0.956 0.005 96.6)',
					mutedForeground: 'oklch(0.560 0.010 84.6)',
					border: 'oklch(0.916 0.009 84.6)',
				},
			},
			{
				key: 'plaster-pink',
				label: 'Plaster pink',
				dark: false,
				shared: false,
				swatch: ['#f1e4dc', '#4a2b28', '#b5442f'],
				shadowRgb: '80,40,30',
				tokens: {
					background: 'oklch(0.927 0.018 54.0)',
					foreground: 'oklch(0.239 0.028 26.7)',
					card: 'oklch(0.955 0.014 53.4)',
					cardForeground: 'oklch(0.239 0.028 26.7)',
					primary: 'oklch(0.327 0.047 25.9)',
					primaryForeground: 'oklch(0.955 0.014 53.4)',
					secondary: 'oklch(0.538 0.151 32.6)',
					muted: 'oklch(0.895 0.023 53.0)',
					mutedForeground: 'oklch(0.544 0.043 34.4)',
					border: 'oklch(0.856 0.029 51.8)',
				},
			},
			{
				key: 'ink-blue',
				label: 'Ink blue',
				dark: false,
				shared: false,
				swatch: ['#eef0f2', '#1c2a4a', '#d0882a'],
				shadowRgb: '20,30,60',
				tokens: {
					background: 'oklch(0.954 0.003 247.9)',
					foreground: 'oklch(0.220 0.037 265.2)',
					card: 'oklch(0.982 0.002 247.8)',
					cardForeground: 'oklch(0.220 0.037 265.2)',
					primary: 'oklch(0.290 0.062 265.0)',
					primaryForeground: 'oklch(0.982 0.002 247.8)',
					secondary: 'oklch(0.686 0.135 68.1)',
					muted: 'oklch(0.927 0.007 251.8)',
					mutedForeground: 'oklch(0.522 0.033 261.4)',
					border: 'oklch(0.893 0.011 256.7)',
				},
			},
			{
				key: 'charcoal-room',
				label: 'Charcoal room',
				dark: true,
				shared: false,
				swatch: ['#161615', '#ece8df', '#e2483a'],
				shadowRgb: '0,0,0',
				tokens: {
					background: 'oklch(0.200 0.002 106.6)',
					foreground: 'oklch(0.932 0.013 86.8)',
					card: 'oklch(0.239 0.004 106.7)',
					cardForeground: 'oklch(0.932 0.013 86.8)',
					primary: 'oklch(0.932 0.013 86.8)',
					primaryForeground: 'oklch(0.200 0.002 106.6)',
					secondary: 'oklch(0.618 0.193 29.0)',
					muted: 'oklch(0.245 0.003 106.6)',
					mutedForeground: 'oklch(0.677 0.015 88.7)',
					border: 'oklch(0.300 0.005 106.7)',
				},
			},
			{
				key: 'brutal',
				label: 'Brutalist',
				dark: false,
				shared: true,
				swatch: ['#ffffff', '#000000', '#ff3d00'],
				shadowRgb: '0,0,0',
				tokens: {
					background: 'oklch(1.000 0.000 89.9)',
					foreground: 'oklch(0.000 0.000 0.0)',
					card: 'oklch(1.000 0.000 89.9)',
					cardForeground: 'oklch(0.000 0.000 0.0)',
					primary: 'oklch(0.654 0.235 34.0)',
					primaryForeground: 'oklch(0.000 0.000 0.0)',
					secondary: 'oklch(0.452 0.313 264.1)',
					muted: 'oklch(0.550 0.000 49.4)',
					mutedForeground: 'oklch(0.289 0.000 89.9)',
					border: 'oklch(0.000 0.000 0.0)',
				},
			},
			{
				key: 'neon',
				label: 'Neon',
				dark: true,
				shared: true,
				swatch: ['#07070c', '#39ff14', '#ff2bd6'],
				shadowRgb: '0,0,0',
				tokens: {
					background: 'oklch(0.131 0.012 284.7)',
					foreground: 'oklch(0.970 0.015 286.1)',
					card: 'oklch(0.183 0.020 284.2)',
					cardForeground: 'oklch(0.970 0.015 286.1)',
					primary: 'oklch(0.871 0.286 141.5)',
					primaryForeground: 'oklch(0.131 0.012 284.7)',
					secondary: 'oklch(0.691 0.282 338.1)',
					muted: 'oklch(0.198 0.025 284.1)',
					mutedForeground: 'oklch(0.696 0.044 285.2)',
					border: 'oklch(0.280 0.042 283.3)',
				},
			},
		],
	},
	cards: {
		id: 'cards',
		label: 'Vault',
		description:
			"A collector's vault after dark. Foil cards that catch the light, rarity filters, set-completion bars and a live sales tape.",
		forWho: 'BTC trading cards market',
		fonts: 'Clash Display \u00b7 JetBrains Mono',
		tune: { radiusPx: 14, shadow: 0.8, glass: 0.7, spacing: 1, texture: 0.15, handmade: 0.1 },
		palettes: [
			{
				key: 'holo-night',
				label: 'Holo night',
				dark: true,
				shared: false,
				swatch: ['#0b0b14', '#8b5cf6', '#22d3ee'],
				shadowRgb: '0,0,0',
				tokens: {
					background: 'oklch(0.155 0.019 283.9)',
					foreground: 'oklch(0.945 0.028 290.2)',
					card: 'oklch(0.205 0.034 283.0)',
					cardForeground: 'oklch(0.945 0.028 290.2)',
					primary: 'oklch(0.606 0.219 292.7)',
					primaryForeground: 'oklch(0.155 0.019 283.9)',
					secondary: 'oklch(0.797 0.134 211.5)',
					muted: 'oklch(0.215 0.040 282.9)',
					mutedForeground: 'oklch(0.657 0.052 287.5)',
					border: 'oklch(0.288 0.065 281.6)',
				},
			},
			{
				key: 'orange-pill',
				label: 'Orange pill',
				dark: true,
				shared: false,
				swatch: ['#120d08', '#f7931a', '#ffd166'],
				shadowRgb: '0,0,0',
				tokens: {
					background: 'oklch(0.164 0.013 67.4)',
					foreground: 'oklch(0.969 0.026 76.8)',
					card: 'oklch(0.206 0.017 66.6)',
					cardForeground: 'oklch(0.969 0.026 76.8)',
					primary: 'oklch(0.752 0.166 62.6)',
					primaryForeground: 'oklch(0.164 0.013 67.4)',
					secondary: 'oklch(0.880 0.135 86.1)',
					muted: 'oklch(0.217 0.020 67.9)',
					mutedForeground: 'oklch(0.704 0.047 70.2)',
					border: 'oklch(0.283 0.029 68.5)',
				},
			},
			{
				key: 'mint-condition',
				label: 'Mint condition',
				dark: false,
				shared: false,
				swatch: ['#eef6f1', '#0f766e', '#e11d48'],
				shadowRgb: '15,60,50',
				tokens: {
					background: 'oklch(0.966 0.011 158.8)',
					foreground: 'oklch(0.222 0.026 173.9)',
					card: 'oklch(1.000 0.000 89.9)',
					cardForeground: 'oklch(0.222 0.026 173.9)',
					primary: 'oklch(0.511 0.086 186.4)',
					primaryForeground: 'oklch(1.000 0.000 89.9)',
					secondary: 'oklch(0.586 0.222 17.6)',
					muted: 'oklch(0.935 0.017 162.5)',
					mutedForeground: 'oklch(0.522 0.033 179.8)',
					border: 'oklch(0.898 0.025 167.0)',
				},
			},
			{
				key: 'arcade',
				label: 'Arcade',
				dark: true,
				shared: false,
				swatch: ['#0a0f0a', '#39ff14', '#ff2bd6'],
				shadowRgb: '0,0,0',
				tokens: {
					background: 'oklch(0.161 0.013 144.9)',
					foreground: 'oklch(0.975 0.046 140.3)',
					card: 'oklch(0.207 0.020 144.8)',
					cardForeground: 'oklch(0.975 0.046 140.3)',
					primary: 'oklch(0.871 0.286 141.5)',
					primaryForeground: 'oklch(0.161 0.013 144.9)',
					secondary: 'oklch(0.691 0.282 338.1)',
					muted: 'oklch(0.215 0.023 144.8)',
					mutedForeground: 'oklch(0.692 0.060 143.4)',
					border: 'oklch(0.282 0.036 144.5)',
				},
			},
			{
				key: 'brutal',
				label: 'Brutalist',
				dark: false,
				shared: true,
				swatch: ['#ffffff', '#000000', '#ff3d00'],
				shadowRgb: '0,0,0',
				tokens: {
					background: 'oklch(1.000 0.000 89.9)',
					foreground: 'oklch(0.000 0.000 0.0)',
					card: 'oklch(1.000 0.000 89.9)',
					cardForeground: 'oklch(0.000 0.000 0.0)',
					primary: 'oklch(0.654 0.235 34.0)',
					primaryForeground: 'oklch(0.000 0.000 0.0)',
					secondary: 'oklch(0.452 0.313 264.1)',
					muted: 'oklch(0.550 0.000 49.4)',
					mutedForeground: 'oklch(0.289 0.000 89.9)',
					border: 'oklch(0.000 0.000 0.0)',
				},
			},
			{
				key: 'neon',
				label: 'Neon',
				dark: true,
				shared: true,
				swatch: ['#07070c', '#39ff14', '#ff2bd6'],
				shadowRgb: '0,0,0',
				tokens: {
					background: 'oklch(0.131 0.012 284.7)',
					foreground: 'oklch(0.970 0.015 286.1)',
					card: 'oklch(0.183 0.020 284.2)',
					cardForeground: 'oklch(0.970 0.015 286.1)',
					primary: 'oklch(0.871 0.286 141.5)',
					primaryForeground: 'oklch(0.131 0.012 284.7)',
					secondary: 'oklch(0.691 0.282 338.1)',
					muted: 'oklch(0.198 0.025 284.1)',
					mutedForeground: 'oklch(0.696 0.044 285.2)',
					border: 'oklch(0.280 0.042 283.3)',
				},
			},
		],
	},
	elec: {
		id: 'elec',
		label: 'Live Wire',
		description:
			'Hi-vis, loud and useful. A giant call-now bar, services you flip on like breakers in a fuse box, and fixed prices up front.',
		forWho: 'Electrician',
		fonts: 'Archivo Expanded \u00b7 Archivo',
		tune: { radiusPx: 4, shadow: 0.5, glass: 0.1, spacing: 1, texture: 0, handmade: 0 },
		palettes: [
			{
				key: 'hi-vis',
				label: 'Hi-vis',
				dark: false,
				shared: false,
				swatch: ['#f4f2ec', '#111111', '#ffd400'],
				shadowRgb: '0,0,0',
				tokens: {
					background: 'oklch(0.961 0.008 91.5)',
					foreground: 'oklch(0.178 0.000 89.9)',
					card: 'oklch(1.000 0.000 89.9)',
					cardForeground: 'oklch(0.178 0.000 89.9)',
					primary: 'oklch(0.881 0.181 94.0)',
					primaryForeground: 'oklch(0.178 0.000 89.9)',
					secondary: 'oklch(0.178 0.000 89.9)',
					muted: 'oklch(0.929 0.011 90.2)',
					mutedForeground: 'oklch(0.468 0.008 88.7)',
					border: 'oklch(0.889 0.014 88.7)',
				},
			},
			{
				key: 'live-red',
				label: 'Live (red)',
				dark: false,
				shared: false,
				swatch: ['#f6f1ee', '#1a1a1a', '#e63312'],
				shadowRgb: '40,10,0',
				tokens: {
					background: 'oklch(0.961 0.007 53.4)',
					foreground: 'oklch(0.218 0.000 89.9)',
					card: 'oklch(1.000 0.000 89.9)',
					cardForeground: 'oklch(0.218 0.000 89.9)',
					primary: 'oklch(0.603 0.218 32.2)',
					primaryForeground: 'oklch(1.000 0.000 89.9)',
					secondary: 'oklch(0.218 0.000 89.9)',
					muted: 'oklch(0.929 0.010 52.2)',
					mutedForeground: 'oklch(0.463 0.013 54.3)',
					border: 'oklch(0.889 0.015 50.8)',
				},
			},
			{
				key: 'earth-green-yellow',
				label: 'Earth (green/yellow)',
				dark: false,
				shared: false,
				swatch: ['#eef1ea', '#1f6b3a', '#f2c200'],
				shadowRgb: '10,40,20',
				tokens: {
					background: 'oklch(0.954 0.010 125.7)',
					foreground: 'oklch(0.242 0.030 157.4)',
					card: 'oklch(1.000 0.000 89.9)',
					cardForeground: 'oklch(0.242 0.030 157.4)',
					primary: 'oklch(0.833 0.170 90.6)',
					primaryForeground: 'oklch(0.242 0.030 157.4)',
					secondary: 'oklch(0.469 0.108 151.4)',
					muted: 'oklch(0.923 0.014 129.0)',
					mutedForeground: 'oklch(0.492 0.028 154.5)',
					border: 'oklch(0.885 0.020 133.1)',
				},
			},
			{
				key: 'blueprint',
				label: 'Blueprint',
				dark: true,
				shared: false,
				swatch: ['#0e1f3a', '#ffffff', '#4cc3ff'],
				shadowRgb: '0,0,0',
				tokens: {
					background: 'oklch(0.241 0.057 259.3)',
					foreground: 'oklch(0.968 0.015 257.2)',
					card: 'oklch(0.283 0.069 258.9)',
					cardForeground: 'oklch(0.968 0.015 257.2)',
					primary: 'oklch(0.775 0.135 234.5)',
					primaryForeground: 'oklch(0.241 0.057 259.3)',
					secondary: 'oklch(1.000 0.000 89.9)',
					muted: 'oklch(0.299 0.068 258.5)',
					mutedForeground: 'oklch(0.761 0.053 258.4)',
					border: 'oklch(0.371 0.083 257.5)',
				},
			},
			{
				key: 'brutal',
				label: 'Brutalist',
				dark: false,
				shared: true,
				swatch: ['#ffffff', '#000000', '#ff3d00'],
				shadowRgb: '0,0,0',
				tokens: {
					background: 'oklch(1.000 0.000 89.9)',
					foreground: 'oklch(0.000 0.000 0.0)',
					card: 'oklch(1.000 0.000 89.9)',
					cardForeground: 'oklch(0.000 0.000 0.0)',
					primary: 'oklch(0.654 0.235 34.0)',
					primaryForeground: 'oklch(0.000 0.000 0.0)',
					secondary: 'oklch(0.452 0.313 264.1)',
					muted: 'oklch(0.550 0.000 49.4)',
					mutedForeground: 'oklch(0.289 0.000 89.9)',
					border: 'oklch(0.000 0.000 0.0)',
				},
			},
			{
				key: 'neon',
				label: 'Neon',
				dark: true,
				shared: true,
				swatch: ['#07070c', '#39ff14', '#ff2bd6'],
				shadowRgb: '0,0,0',
				tokens: {
					background: 'oklch(0.131 0.012 284.7)',
					foreground: 'oklch(0.970 0.015 286.1)',
					card: 'oklch(0.183 0.020 284.2)',
					cardForeground: 'oklch(0.970 0.015 286.1)',
					primary: 'oklch(0.871 0.286 141.5)',
					primaryForeground: 'oklch(0.131 0.012 284.7)',
					secondary: 'oklch(0.691 0.282 338.1)',
					muted: 'oklch(0.198 0.025 284.1)',
					mutedForeground: 'oklch(0.696 0.044 285.2)',
					border: 'oklch(0.280 0.042 283.3)',
				},
			},
		],
	},
	law: {
		id: 'law',
		label: 'Chambers',
		description:
			'Composed and centred, set like a legal document. Practice areas as numbered clauses, monogrammed partners, published fixed fees.',
		forWho: 'Solicitors',
		fonts: 'Gambetta \u00b7 Switzer',
		tune: { radiusPx: 0, shadow: 0.08, glass: 0.2, spacing: 1.2, texture: 0.25, handmade: 0 },
		palettes: [
			{
				key: 'oxblood',
				label: 'Oxblood',
				dark: false,
				shared: false,
				swatch: ['#f5f1ea', '#5b1a1f', '#9c7a3c'],
				shadowRgb: '50,30,20',
				tokens: {
					background: 'oklch(0.959 0.010 81.8)',
					foreground: 'oklch(0.221 0.009 59.2)',
					card: 'oklch(0.980 0.007 80.7)',
					cardForeground: 'oklch(0.221 0.009 59.2)',
					primary: 'oklch(0.325 0.095 19.8)',
					primaryForeground: 'oklch(0.980 0.007 80.7)',
					secondary: 'oklch(0.600 0.090 80.6)',
					muted: 'oklch(0.921 0.015 80.6)',
					mutedForeground: 'oklch(0.511 0.017 70.7)',
					border: 'oklch(0.873 0.021 79.1)',
				},
			},
			{
				key: 'inns-navy',
				label: 'Inns navy',
				dark: false,
				shared: false,
				swatch: ['#f2f2ee', '#1b2a44', '#8a6d3b'],
				shadowRgb: '20,30,50',
				tokens: {
					background: 'oklch(0.960 0.005 106.5)',
					foreground: 'oklch(0.218 0.021 264.0)',
					card: 'oklch(0.984 0.004 106.5)',
					cardForeground: 'oklch(0.218 0.021 264.0)',
					primary: 'oklch(0.285 0.052 260.9)',
					primaryForeground: 'oklch(0.984 0.004 106.5)',
					secondary: 'oklch(0.552 0.077 79.7)',
					muted: 'oklch(0.924 0.008 106.6)',
					mutedForeground: 'oklch(0.507 0.023 267.1)',
					border: 'oklch(0.880 0.011 106.6)',
				},
			},
			{
				key: 'parchment',
				label: 'Parchment',
				dark: false,
				shared: false,
				swatch: ['#efe6d2', '#3a3226', '#2f5d50'],
				shadowRgb: '60,50,30',
				tokens: {
					background: 'oklch(0.927 0.028 86.6)',
					foreground: 'oklch(0.264 0.018 77.8)',
					card: 'oklch(0.956 0.024 88.2)',
					cardForeground: 'oklch(0.264 0.018 77.8)',
					primary: 'oklch(0.322 0.023 77.8)',
					primaryForeground: 'oklch(0.956 0.024 88.2)',
					secondary: 'oklch(0.441 0.056 173.2)',
					muted: 'oklch(0.895 0.033 86.8)',
					mutedForeground: 'oklch(0.533 0.034 80.5)',
					border: 'oklch(0.857 0.039 86.9)',
				},
			},
			{
				key: 'robing-room',
				label: 'Robing room',
				dark: true,
				shared: false,
				swatch: ['#14161a', '#d7c49e', '#8e2b30'],
				shadowRgb: '0,0,0',
				tokens: {
					background: 'oklch(0.200 0.009 264.4)',
					foreground: 'oklch(0.926 0.014 84.6)',
					card: 'oklch(0.234 0.011 260.7)',
					cardForeground: 'oklch(0.926 0.014 84.6)',
					primary: 'oklch(0.827 0.055 84.5)',
					primaryForeground: 'oklch(0.200 0.009 264.4)',
					secondary: 'oklch(0.588 0.136 19.4)',
					muted: 'oklch(0.249 0.011 263.2)',
					mutedForeground: 'oklch(0.675 0.019 84.6)',
					border: 'oklch(0.308 0.014 261.7)',
				},
			},
			{
				key: 'brutal',
				label: 'Brutalist',
				dark: false,
				shared: true,
				swatch: ['#ffffff', '#000000', '#ff3d00'],
				shadowRgb: '0,0,0',
				tokens: {
					background: 'oklch(1.000 0.000 89.9)',
					foreground: 'oklch(0.000 0.000 0.0)',
					card: 'oklch(1.000 0.000 89.9)',
					cardForeground: 'oklch(0.000 0.000 0.0)',
					primary: 'oklch(0.654 0.235 34.0)',
					primaryForeground: 'oklch(0.000 0.000 0.0)',
					secondary: 'oklch(0.452 0.313 264.1)',
					muted: 'oklch(0.550 0.000 49.4)',
					mutedForeground: 'oklch(0.289 0.000 89.9)',
					border: 'oklch(0.000 0.000 0.0)',
				},
			},
			{
				key: 'neon',
				label: 'Neon',
				dark: true,
				shared: true,
				swatch: ['#07070c', '#39ff14', '#ff2bd6'],
				shadowRgb: '0,0,0',
				tokens: {
					background: 'oklch(0.131 0.012 284.7)',
					foreground: 'oklch(0.970 0.015 286.1)',
					card: 'oklch(0.183 0.020 284.2)',
					cardForeground: 'oklch(0.970 0.015 286.1)',
					primary: 'oklch(0.871 0.286 141.5)',
					primaryForeground: 'oklch(0.131 0.012 284.7)',
					secondary: 'oklch(0.691 0.282 338.1)',
					muted: 'oklch(0.198 0.025 284.1)',
					mutedForeground: 'oklch(0.696 0.044 285.2)',
					border: 'oklch(0.280 0.042 283.3)',
				},
			},
		],
	},
	acct: {
		id: 'acct',
		label: 'Ledger',
		description:
			'Crisp ledger paper and tabular numbers. A live deadline tracker, a fee estimator you can drag, and bitcoin-aware bookkeeping.',
		forWho: 'Accountants',
		fonts: 'General Sans \u00b7 IBM Plex Mono',
		tune: { radiusPx: 8, shadow: 0.25, glass: 0.3, spacing: 1, texture: 0, handmade: 0 },
		palettes: [
			{
				key: 'ledger-green',
				label: 'Ledger green',
				dark: false,
				shared: false,
				swatch: ['#f6f8f4', '#14532d', '#d97706'],
				shadowRgb: '20,50,30',
				tokens: {
					background: 'oklch(0.977 0.006 128.5)',
					foreground: 'oklch(0.204 0.022 152.6)',
					card: 'oklch(1.000 0.000 89.9)',
					cardForeground: 'oklch(0.204 0.022 152.6)',
					primary: 'oklch(0.393 0.090 152.5)',
					primaryForeground: 'oklch(1.000 0.000 89.9)',
					secondary: 'oklch(0.666 0.157 58.3)',
					muted: 'oklch(0.947 0.011 135.0)',
					mutedForeground: 'oklch(0.510 0.029 152.3)',
					border: 'oklch(0.911 0.018 142.8)',
				},
			},
			{
				key: 'ink-paper',
				label: 'Ink & paper',
				dark: false,
				shared: false,
				swatch: ['#fafaf8', '#18181b', '#2563eb'],
				shadowRgb: '20,20,30',
				tokens: {
					background: 'oklch(0.985 0.003 106.4)',
					foreground: 'oklch(0.210 0.006 285.9)',
					card: 'oklch(1.000 0.000 89.9)',
					cardForeground: 'oklch(0.210 0.006 285.9)',
					primary: 'oklch(0.210 0.006 285.9)',
					primaryForeground: 'oklch(1.000 0.000 89.9)',
					secondary: 'oklch(0.546 0.215 262.9)',
					muted: 'oklch(0.954 0.004 106.5)',
					mutedForeground: 'oklch(0.502 0.013 285.9)',
					border: 'oklch(0.918 0.005 106.5)',
				},
			},
			{
				key: 'spreadsheet',
				label: 'Spreadsheet',
				dark: false,
				shared: false,
				swatch: ['#f3f6fb', '#1d4ed8', '#16a34a'],
				shadowRgb: '20,40,90',
				tokens: {
					background: 'oklch(0.972 0.007 260.7)',
					foreground: 'oklch(0.208 0.040 265.8)',
					card: 'oklch(1.000 0.000 89.9)',
					cardForeground: 'oklch(0.208 0.040 265.8)',
					primary: 'oklch(0.488 0.217 264.4)',
					primaryForeground: 'oklch(1.000 0.000 89.9)',
					secondary: 'oklch(0.627 0.170 149.2)',
					muted: 'oklch(0.943 0.013 260.5)',
					mutedForeground: 'oklch(0.503 0.034 266.1)',
					border: 'oklch(0.908 0.020 260.2)',
				},
			},
			{
				key: 'year-end',
				label: 'Year end',
				dark: true,
				shared: false,
				swatch: ['#0f1412', '#4ade80', '#fbbf24'],
				shadowRgb: '0,0,0',
				tokens: {
					background: 'oklch(0.185 0.009 169.2)',
					foreground: 'oklch(0.945 0.011 149.9)',
					card: 'oklch(0.223 0.012 167.4)',
					cardForeground: 'oklch(0.945 0.011 149.9)',
					primary: 'oklch(0.800 0.182 151.7)',
					primaryForeground: 'oklch(0.185 0.009 169.2)',
					secondary: 'oklch(0.837 0.164 84.4)',
					muted: 'oklch(0.235 0.013 168.5)',
					mutedForeground: 'oklch(0.700 0.023 158.3)',
					border: 'oklch(0.296 0.019 167.7)',
				},
			},
			{
				key: 'brutal',
				label: 'Brutalist',
				dark: false,
				shared: true,
				swatch: ['#ffffff', '#000000', '#ff3d00'],
				shadowRgb: '0,0,0',
				tokens: {
					background: 'oklch(1.000 0.000 89.9)',
					foreground: 'oklch(0.000 0.000 0.0)',
					card: 'oklch(1.000 0.000 89.9)',
					cardForeground: 'oklch(0.000 0.000 0.0)',
					primary: 'oklch(0.654 0.235 34.0)',
					primaryForeground: 'oklch(0.000 0.000 0.0)',
					secondary: 'oklch(0.452 0.313 264.1)',
					muted: 'oklch(0.550 0.000 49.4)',
					mutedForeground: 'oklch(0.289 0.000 89.9)',
					border: 'oklch(0.000 0.000 0.0)',
				},
			},
			{
				key: 'neon',
				label: 'Neon',
				dark: true,
				shared: true,
				swatch: ['#07070c', '#39ff14', '#ff2bd6'],
				shadowRgb: '0,0,0',
				tokens: {
					background: 'oklch(0.131 0.012 284.7)',
					foreground: 'oklch(0.970 0.015 286.1)',
					card: 'oklch(0.183 0.020 284.2)',
					cardForeground: 'oklch(0.970 0.015 286.1)',
					primary: 'oklch(0.871 0.286 141.5)',
					primaryForeground: 'oklch(0.131 0.012 284.7)',
					secondary: 'oklch(0.691 0.282 338.1)',
					muted: 'oklch(0.198 0.025 284.1)',
					mutedForeground: 'oklch(0.696 0.044 285.2)',
					border: 'oklch(0.280 0.042 283.3)',
				},
			},
		],
	},
	pleb: {
		id: 'pleb',
		label: 'Plebeian',
		description:
			'Community-first e-commerce. Leads with live and featured auctions, then categories you can click into, featured products, seller shops and well-reviewed favourites.',
		forWho: 'Community marketplace',
		fonts: 'Anton \u00b7 DM Sans \u00b7 JetBrains Mono',
		tune: { radiusPx: 12, shadow: 0.3, glass: 0.6, spacing: 1, texture: 0, handmade: 0 },
		palettes: [
			{
				key: 'plebeian',
				label: 'Plebeian',
				dark: false,
				shared: false,
				swatch: ['#fbf8f5', '#141414', '#ff4fa3'],
				shadowRgb: '40,25,15',
				tokens: {
					background: 'oklch(0.981 0.005 67.8)',
					foreground: 'oklch(0.191 0.000 89.9)',
					card: 'oklch(0.945 0.010 72.7)',
					cardForeground: 'oklch(0.191 0.000 89.9)',
					primary: 'oklch(0.191 0.000 89.9)',
					primaryForeground: 'oklch(1.000 0.000 89.9)',
					secondary: 'oklch(0.695 0.223 355.3)',
					muted: 'oklch(0.947 0.009 69.4)',
					mutedForeground: 'oklch(0.508 0.014 67.5)',
					border: 'oklch(0.907 0.013 71.3)',
				},
			},
			{
				key: 'soft-pink',
				label: 'Soft pink',
				dark: false,
				shared: false,
				swatch: ['#f9ece8', '#1d1d1d', '#d6336c'],
				shadowRgb: '120,50,40',
				tokens: {
					background: 'oklch(0.976 0.010 41.9)',
					foreground: 'oklch(0.231 0.000 89.9)',
					card: 'oklch(0.929 0.022 38.3)',
					cardForeground: 'oklch(0.231 0.000 89.9)',
					primary: 'oklch(0.231 0.000 89.9)',
					primaryForeground: 'oklch(0.976 0.010 41.9)',
					secondary: 'oklch(0.588 0.201 5.2)',
					muted: 'oklch(0.941 0.018 41.1)',
					mutedForeground: 'oklch(0.511 0.029 36.5)',
					border: 'oklch(0.899 0.028 40.2)',
				},
			},
			{
				key: 'sats-orange',
				label: 'Sats orange',
				dark: false,
				shared: false,
				swatch: ['#ffffff', '#111111', '#f7931a'],
				shadowRgb: '30,20,0',
				tokens: {
					background: 'oklch(1.000 0.000 89.9)',
					foreground: 'oklch(0.178 0.000 89.9)',
					card: 'oklch(0.967 0.003 106.4)',
					cardForeground: 'oklch(0.178 0.000 89.9)',
					primary: 'oklch(0.752 0.166 62.6)',
					primaryForeground: 'oklch(0.178 0.000 89.9)',
					secondary: 'oklch(0.752 0.166 62.6)',
					muted: 'oklch(0.965 0.003 87.5)',
					mutedForeground: 'oklch(0.497 0.007 84.6)',
					border: 'oklch(0.922 0.006 84.6)',
				},
			},
			{
				key: 'night-market',
				label: 'Night market',
				dark: true,
				shared: false,
				swatch: ['#0e0c10', '#ff4fa3', '#ff8a3d'],
				shadowRgb: '0,0,0',
				tokens: {
					background: 'oklch(0.159 0.009 307.8)',
					foreground: 'oklch(0.949 0.011 71.9)',
					card: 'oklch(0.211 0.012 307.8)',
					cardForeground: 'oklch(0.949 0.011 71.9)',
					primary: 'oklch(0.695 0.223 355.3)',
					primaryForeground: 'oklch(0.159 0.009 307.8)',
					secondary: 'oklch(0.750 0.167 50.5)',
					muted: 'oklch(0.213 0.014 307.8)',
					mutedForeground: 'oklch(0.698 0.017 328.9)',
					border: 'oklch(0.278 0.019 307.7)',
				},
			},
			{
				key: 'brutal',
				label: 'Brutalist',
				dark: false,
				shared: true,
				swatch: ['#ffffff', '#000000', '#ff3d00'],
				shadowRgb: '0,0,0',
				tokens: {
					background: 'oklch(1.000 0.000 89.9)',
					foreground: 'oklch(0.000 0.000 0.0)',
					card: 'oklch(1.000 0.000 89.9)',
					cardForeground: 'oklch(0.000 0.000 0.0)',
					primary: 'oklch(0.654 0.235 34.0)',
					primaryForeground: 'oklch(0.000 0.000 0.0)',
					secondary: 'oklch(0.452 0.313 264.1)',
					muted: 'oklch(0.550 0.000 49.4)',
					mutedForeground: 'oklch(0.289 0.000 89.9)',
					border: 'oklch(0.000 0.000 0.0)',
				},
			},
			{
				key: 'neon',
				label: 'Neon',
				dark: true,
				shared: true,
				swatch: ['#07070c', '#39ff14', '#ff2bd6'],
				shadowRgb: '0,0,0',
				tokens: {
					background: 'oklch(0.131 0.012 284.7)',
					foreground: 'oklch(0.970 0.015 286.1)',
					card: 'oklch(0.183 0.020 284.2)',
					cardForeground: 'oklch(0.970 0.015 286.1)',
					primary: 'oklch(0.871 0.286 141.5)',
					primaryForeground: 'oklch(0.131 0.012 284.7)',
					secondary: 'oklch(0.691 0.282 338.1)',
					muted: 'oklch(0.198 0.025 284.1)',
					mutedForeground: 'oklch(0.696 0.044 285.2)',
					border: 'oklch(0.280 0.042 283.3)',
				},
			},
		],
	},
	brut: {
		id: 'brut',
		label: 'Concrete',
		description:
			'Raw, loud and honest. Giant type, hard black rules, an index-style product list, hard offset shadows and greyscale photos that flood with colour on hover.',
		forWho: 'Brutalist shop',
		fonts: 'Bricolage Grotesque \u00b7 Space Mono',
		tune: { radiusPx: 0, shadow: 0.6, glass: 0, spacing: 1, texture: 0.15, handmade: 0.2 },
		palettes: [
			{
				key: 'brutal',
				label: 'Brutalist',
				dark: false,
				shared: true,
				swatch: ['#ffffff', '#000000', '#ff3d00'],
				shadowRgb: '0,0,0',
				tokens: {
					background: 'oklch(1.000 0.000 89.9)',
					foreground: 'oklch(0.000 0.000 0.0)',
					card: 'oklch(1.000 0.000 89.9)',
					cardForeground: 'oklch(0.000 0.000 0.0)',
					primary: 'oklch(0.654 0.235 34.0)',
					primaryForeground: 'oklch(0.000 0.000 0.0)',
					secondary: 'oklch(0.452 0.313 264.1)',
					muted: 'oklch(0.550 0.000 49.4)',
					mutedForeground: 'oklch(0.289 0.000 89.9)',
					border: 'oklch(0.000 0.000 0.0)',
				},
			},
			{
				key: 'concrete',
				label: 'Concrete',
				dark: false,
				shared: false,
				swatch: ['#d6d3cc', '#111111', '#e10600'],
				shadowRgb: '0,0,0',
				tokens: {
					background: 'oklch(0.867 0.010 87.5)',
					foreground: 'oklch(0.178 0.000 89.9)',
					card: 'oklch(0.907 0.010 87.5)',
					cardForeground: 'oklch(0.178 0.000 89.9)',
					primary: 'oklch(0.573 0.233 29.5)',
					primaryForeground: 'oklch(1.000 0.000 89.9)',
					secondary: 'oklch(0.178 0.000 89.9)',
					muted: 'oklch(0.557 0.006 88.6)',
					mutedForeground: 'oklch(0.353 0.007 84.6)',
					border: 'oklch(0.178 0.000 89.9)',
				},
			},
			{
				key: 'neon',
				label: 'Neon',
				dark: true,
				shared: true,
				swatch: ['#07070c', '#39ff14', '#ff2bd6'],
				shadowRgb: '0,0,0',
				tokens: {
					background: 'oklch(0.131 0.012 284.7)',
					foreground: 'oklch(0.970 0.015 286.1)',
					card: 'oklch(0.183 0.020 284.2)',
					cardForeground: 'oklch(0.970 0.015 286.1)',
					primary: 'oklch(0.871 0.286 141.5)',
					primaryForeground: 'oklch(0.131 0.012 284.7)',
					secondary: 'oklch(0.691 0.282 338.1)',
					muted: 'oklch(0.198 0.025 284.1)',
					mutedForeground: 'oklch(0.696 0.044 285.2)',
					border: 'oklch(0.280 0.042 283.3)',
				},
			},
			{
				key: 'acid',
				label: 'Acid',
				dark: false,
				shared: false,
				swatch: ['#e6ff3a', '#000000', '#7a00ff'],
				shadowRgb: '0,0,0',
				tokens: {
					background: 'oklch(0.950 0.204 117.0)',
					foreground: 'oklch(0.000 0.000 0.0)',
					card: 'oklch(0.964 0.146 115.0)',
					cardForeground: 'oklch(0.000 0.000 0.0)',
					primary: 'oklch(0.000 0.000 0.0)',
					primaryForeground: 'oklch(0.950 0.204 117.0)',
					secondary: 'oklch(0.524 0.293 292.0)',
					muted: 'oklch(0.523 0.112 64.4)',
					mutedForeground: 'oklch(0.290 0.066 116.0)',
					border: 'oklch(0.000 0.000 0.0)',
				},
			},
		],
	},
}

/** The registry, with each layout's default palette projected onto `tokens`. */
export const STOREFRONT_THEMES = Object.fromEntries(
	Object.entries(THEME_DATA).map(([id, data]) => [id, { ...data, tokens: data.palettes[0].tokens }]),
) as Record<StorefrontThemeId, StorefrontThemeDefinition>

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
 * Resolves a palette key inside a layout, falling back to that layout's own
 * default rather than throwing. A palette key that belongs to a *different*
 * layout also falls back — layouts do not share a palette namespace, they share
 * two named palettes.
 */
export function getStorefrontPalette(theme: StorefrontThemeDefinition, key: string | undefined): StorefrontThemePalette {
	if (key) {
		const found = theme.palettes.find((p) => p.key === key)
		if (found) return found
	}
	return theme.palettes[0]
}

/** The palette keys a layout offers — its own colourways plus the shared pair. */
export function storefrontThemePaletteKeys(themeId: StorefrontThemeId): string[] {
	return getStorefrontTheme(themeId).palettes.map((palette) => palette.key)
}

/**
 * True when a key is one of that layout's palettes.
 *
 * The two shared colourways (Brutalist, Neon) are part of every layout except
 * the one that opts out, so they answer true wherever they are actually
 * offered — this reads the layout's own list rather than a global one.
 */
export function isPaletteInTheme(themeId: StorefrontThemeId, key: string): boolean {
	return storefrontThemePaletteKeys(themeId).includes(key)
}

/**
 * Checks that a page's palette belongs to its layout — the pairing the schema
 * cannot check.
 *
 * `storefront.ts` deliberately knows nothing about what a theme contains: it
 * holds the closed *list* of palette keys and leaves their meaning to this
 * registry. The consequence is that a document naming, say, `theme: 'elec'`
 * with `palette: 'holo-night'` (a `cards` colourway) validates cleanly and then
 * silently renders the layout's *default* palette. The author's explicit choice
 * disappears and nothing says so.
 *
 * That happened for real: a page published from a staging instance carried
 * exactly that pairing, with `cards`' default tune, because the sidebar's
 * layout switch did not reset the palette and tune the way the wizard does.
 *
 * This is the strict half of the answer, for use on the *publish* path where
 * the author is present and can fix it. Rendering keeps the lenient fallback in
 * `getStorefrontPalette`, because a page that crossed a relay must still render
 * — the same split the block union already uses.
 */
export function validateStorefrontThemeSelection(props: { theme?: string; palette?: string }): string[] {
	const theme = getStorefrontTheme(props.theme)
	const key = props.palette ?? ''
	// Empty is the documented "this layout's default colourway".
	if (key === '') return []
	if (isPaletteInTheme(theme.id, key)) return []
	return [`Palette "${key}" does not belong to the "${theme.label}" layout. Available: ${storefrontThemePaletteKeys(theme.id).join(', ')}`]
}

/**
 * Projects a theme's tokens onto the standard CSS custom property names the
 * rest of the app already reads (`--primary`, `--card`, …). Applied as an
 * inline `style` on a wrapper element — the mechanism ADR-0006 specifies —
 * so the override wins at a closer DOM scope than whatever the page's
 * ancestors define, with no component-level theme awareness required.
 *
 * Called with only a theme it returns the ten colour properties and nothing
 * else, which is what the pre-existing render path expects. Passing a palette
 * key and/or a tune adds the corresponding properties.
 */
export function storefrontThemeCssVars(theme: StorefrontThemeDefinition, paletteKey?: string, tune?: StorefrontThemeTune): CSSProperties {
	const palette = getStorefrontPalette(theme, paletteKey)
	const vars: Record<string, string> = {
		'--background': palette.tokens.background,
		'--foreground': palette.tokens.foreground,
		'--card': palette.tokens.card,
		'--card-foreground': palette.tokens.cardForeground,
		'--primary': palette.tokens.primary,
		'--primary-foreground': palette.tokens.primaryForeground,
		'--secondary': palette.tokens.secondary,
		'--muted': palette.tokens.muted,
		'--muted-foreground': palette.tokens.mutedForeground,
		'--border': palette.tokens.border,
	}

	if (tune !== undefined) {
		Object.assign(vars, storefrontTuneCssVars(palette, tune))
	}

	return vars as CSSProperties
}

/**
 * The tune half of the projection. Every value is a number that has already
 * been clamped by the schema or by `normalizeStorefrontTune`, so what lands in
 * the page is arithmetic the app performed — there is no path from a published
 * document to a raw CSS string.
 *
 * `data-storefront-*` attributes are flattened to 0–1 factors for the three
 * axes the stylesheet cannot express arithmetically (glass, texture, handmade);
 * radius and spacing can be used directly in `calc()`.
 */
export function storefrontTuneCssVars(palette: StorefrontThemePalette, tune: StorefrontThemeTune): Record<string, string> {
	return {
		'--storefront-radius': `${tune.radiusPx}px`,
		'--storefront-radius-sm': `${Math.round(tune.radiusPx * 0.5)}px`,
		'--storefront-shadow': String(tune.shadow),
		'--storefront-shadow-rgb': palette.shadowRgb,
		'--storefront-glass': String(tune.glass),
		'--storefront-spacing': String(tune.spacing),
		'--storefront-texture': String(tune.texture),
		'--storefront-handmade': String(tune.handmade),
		'--radius': `${tune.radiusPx}px`,
	}
}

/** The five swatch dots a picker shows for one theme — enough to read its vibe at a glance. */
export function storefrontThemeSwatchColors(theme: StorefrontThemeDefinition): string[] {
	return [theme.tokens.background, theme.tokens.primary, theme.tokens.secondary, theme.tokens.muted, theme.tokens.foreground]
}

/** The three dots one *palette* shows, straight from the studio's `sw`. */
export function storefrontPaletteSwatchColors(palette: StorefrontThemePalette): string[] {
	return palette.swatch
}
