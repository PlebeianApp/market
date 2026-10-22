import { describe, expect, test } from 'bun:test'
import { STOREFRONT_THEME_IDS } from '@/lib/schemas/storefront'
import {
	getStorefrontTheme,
	isPaletteInTheme,
	storefrontThemeCssVars,
	storefrontThemePaletteKeys,
	storefrontThemeSwatchColors,
	validateStorefrontThemeSelection,
	STOREFRONT_THEMES,
	STOREFRONT_THEME_LIST,
} from './storefrontThemes'

const OKLCH_PATTERN = /^oklch\([\d.]+ [\d.]+ [\d.]+\)$/

describe('STOREFRONT_THEMES registry', () => {
	test('has exactly one entry per id in the schema — the CMS and the schema can never list different themes', () => {
		const registryIds = Object.keys(STOREFRONT_THEMES).sort()
		expect(registryIds).toEqual([...STOREFRONT_THEME_IDS].sort())
	})

	test('STOREFRONT_THEME_LIST follows the schema-declared order', () => {
		expect(STOREFRONT_THEME_LIST.map((t) => t.id)).toEqual([...STOREFRONT_THEME_IDS])
	})

	test('every theme defines all ten tokens as non-empty oklch() strings', () => {
		const tokenKeys: (keyof (typeof STOREFRONT_THEMES)['default']['tokens'])[] = [
			'background',
			'foreground',
			'card',
			'cardForeground',
			'primary',
			'primaryForeground',
			'secondary',
			'muted',
			'mutedForeground',
			'border',
		]

		for (const theme of STOREFRONT_THEME_LIST) {
			for (const key of tokenKeys) {
				const value = theme.tokens[key]
				expect(value, `${theme.id}.${key}`).toMatch(OKLCH_PATTERN)
			}
		}
	})

	test('every theme has a label and a description', () => {
		for (const theme of STOREFRONT_THEME_LIST) {
			expect(theme.label.length, theme.id).toBeGreaterThan(0)
			expect(theme.description.length, theme.id).toBeGreaterThan(0)
		}
	})

	test('id field matches the key it is stored under', () => {
		for (const [key, theme] of Object.entries(STOREFRONT_THEMES)) {
			expect(key).toBe(theme.id)
		}
	})
})

describe('getStorefrontTheme', () => {
	test('returns the matching theme for a valid id', () => {
		expect(getStorefrontTheme('midnight').id).toBe('midnight')
	})

	test('falls back to default for an id outside the closed set, rather than throwing', () => {
		expect(getStorefrontTheme('nonexistent-theme').id).toBe('default')
		expect(getStorefrontTheme('__proto__').id).toBe('default')
		expect(getStorefrontTheme('constructor').id).toBe('default')
	})

	test('falls back to default for undefined', () => {
		expect(getStorefrontTheme(undefined).id).toBe('default')
	})
})

describe('storefrontThemeCssVars', () => {
	test('produces every custom property name the storefront components read', () => {
		const vars = storefrontThemeCssVars(STOREFRONT_THEMES.midnight) as Record<string, string>
		expect(vars).toEqual({
			'--background': STOREFRONT_THEMES.midnight.tokens.background,
			'--foreground': STOREFRONT_THEMES.midnight.tokens.foreground,
			'--card': STOREFRONT_THEMES.midnight.tokens.card,
			'--card-foreground': STOREFRONT_THEMES.midnight.tokens.cardForeground,
			'--primary': STOREFRONT_THEMES.midnight.tokens.primary,
			'--primary-foreground': STOREFRONT_THEMES.midnight.tokens.primaryForeground,
			'--secondary': STOREFRONT_THEMES.midnight.tokens.secondary,
			'--muted': STOREFRONT_THEMES.midnight.tokens.muted,
			'--muted-foreground': STOREFRONT_THEMES.midnight.tokens.mutedForeground,
			'--border': STOREFRONT_THEMES.midnight.tokens.border,
		})
	})
})

describe('storefrontThemeSwatchColors', () => {
	test('returns five colors for the picker dots', () => {
		expect(storefrontThemeSwatchColors(STOREFRONT_THEMES.default)).toHaveLength(5)
	})
})

describe('isPaletteInTheme — a colourway belongs to a layout, not to the app', () => {
	test('a layout offers its own colourways', () => {
		expect(isPaletteInTheme('elec', 'hi-vis')).toBe(true)
		expect(isPaletteInTheme('cards', 'holo-night')).toBe(true)
	})

	test('a colourway from another layout does not belong', () => {
		expect(isPaletteInTheme('elec', 'holo-night')).toBe(false)
		expect(isPaletteInTheme('cards', 'hi-vis')).toBe(false)
		// `concrete` and `acid` are brut's alone; nothing else offers them.
		expect(isPaletteInTheme('elec', 'concrete')).toBe(false)
		expect(isPaletteInTheme('farm', 'acid')).toBe(false)
	})

	test('the shared pair is offered by the layouts that receive it', () => {
		expect(isPaletteInTheme('elec', 'brutal')).toBe(true)
		expect(isPaletteInTheme('elec', 'neon')).toBe(true)
		expect(isPaletteInTheme('farm', 'brutal')).toBe(true)
	})

	test('brut opted out of the shared pair and lists its own set instead', () => {
		expect(isPaletteInTheme('brut', 'brutal')).toBe(true)
		expect(isPaletteInTheme('brut', 'neon')).toBe(true)
		expect(isPaletteInTheme('brut', 'concrete')).toBe(true)
		expect(isPaletteInTheme('brut', 'acid')).toBe(true)
		expect(isPaletteInTheme('brut', 'holo-night')).toBe(false)
	})

	test('every layout accepts every key it actually offers', () => {
		for (const theme of STOREFRONT_THEME_LIST) {
			for (const key of storefrontThemePaletteKeys(theme.id)) {
				expect(isPaletteInTheme(theme.id, key), `${theme.id}/${key}`).toBe(true)
			}
		}
	})
})

describe('validateStorefrontThemeSelection — the pairing the schema cannot check', () => {
	test('accepts a colourway that belongs to the layout', () => {
		expect(validateStorefrontThemeSelection({ theme: 'elec', palette: 'hi-vis' })).toEqual([])
	})

	test('accepts an empty key, which means "this layout default"', () => {
		expect(validateStorefrontThemeSelection({ theme: 'elec', palette: '' })).toEqual([])
		expect(validateStorefrontThemeSelection({ theme: 'elec' })).toEqual([])
	})

	test('rejects the exact pairing a real published page shipped with', () => {
		// theme=elec alongside the `cards` colourway holo-night — and `cards`'
		// default tune. The layout switch wrote only the layout.
		const errors = validateStorefrontThemeSelection({ theme: 'elec', palette: 'holo-night' })
		expect(errors).toHaveLength(1)
		expect(errors[0]).toContain('holo-night')
		expect(errors[0]).toContain('Live Wire')
		expect(errors[0]).toContain('hi-vis')
	})

	test('agrees with isPaletteInTheme across every layout and every key in the app', () => {
		const everyKey = Array.from(new Set(STOREFRONT_THEME_LIST.flatMap((theme) => storefrontThemePaletteKeys(theme.id))))
		for (const theme of STOREFRONT_THEME_LIST) {
			for (const key of everyKey) {
				const accepted = validateStorefrontThemeSelection({ theme: theme.id, palette: key }).length === 0
				expect(accepted, `${theme.id}/${key}`).toBe(isPaletteInTheme(theme.id, key))
			}
		}
	})

	test('an unknown layout id resolves to default rather than throwing', () => {
		expect(validateStorefrontThemeSelection({ theme: 'not-a-layout', palette: '' })).toEqual([])
		expect(validateStorefrontThemeSelection({ theme: 'not-a-layout', palette: 'holo-night' })).toHaveLength(1)
	})
})
