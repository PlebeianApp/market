import { describe, expect, test } from 'bun:test'
import { STOREFRONT_THEME_IDS } from '@/lib/schemas/storefront'
import {
	getStorefrontTheme,
	storefrontThemeCssVars,
	storefrontThemeSwatchColors,
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
