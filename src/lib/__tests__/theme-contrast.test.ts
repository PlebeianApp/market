import { describe, expect, test } from 'bun:test'

/*
 * Theme contrast checks — deterministic WCAG AA verification for UX-state
 * tokens defined in styles/globals-new.css.
 *
 * Values mirror styles/globals-new.css — update both when changing tokens.
 * Each test converts oklch → sRGB → relative luminance and asserts a
 * contrast ratio >= 4.5:1 (WCAG AA for normal text).
 */

/** Convert oklch to linear sRGB, then compute WCAG relative luminance. */
function oklchToLuminance(L: number, C: number, h: number): number {
	const hr = (h * Math.PI) / 180
	const a = C * Math.cos(hr)
	const b = C * Math.sin(hr)

	const l_ = L + 0.3963377774 * a + 0.2158037573 * b
	const m_ = L - 0.1055613458 * a - 0.0638541728 * b
	const s_ = L - 0.0894841775 * a - 1.291485548 * b

	const l = l_ ** 3
	const m = m_ ** 3
	const s = s_ ** 3

	const r = Math.max(0, Math.min(1, 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s))
	const g = Math.max(0, Math.min(1, -1.2684380041 * l + 2.6097574051 * m - 0.3413193965 * s))
	const bl = Math.max(0, Math.min(1, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s))

	function toLinear(c: number): number {
		return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
	}

	function srgbToLinear(c: number): number {
		if (c <= 0.03928) return c / 12.92
		return ((c + 0.055) / 1.055) ** 2.4
	}

	const R = srgbToLinear(toLinear(r))
	const G = srgbToLinear(toLinear(g))
	const B = srgbToLinear(toLinear(bl))

	return 0.2126 * R + 0.7152 * G + 0.0722 * B
}

function contrastRatio(lum1: number, lum2: number): number {
	const lighter = Math.max(lum1, lum2)
	const darker = Math.min(lum1, lum2)
	return (lighter + 0.05) / (darker + 0.05)
}

// Token pairs from styles/globals-new.css — [fill, foreground] in oklch
const LIGHT_MODE_TOKENS = {
	info: { fill: [0.623, 0.188, 259.8], fg: [0.237, 0.059, 259] },
	warning: { fill: [0.769, 0.165, 70.1], fg: [0.216, 0.006, 56] },
	error: { fill: [0.637, 0.208, 25.3], fg: [0.205, 0.057, 23.5] },
	success: { fill: [0.723, 0.192, 149.6], fg: [0.266, 0.063, 152.9] },
} as const

const DARK_MODE_TOKENS = {
	info: { fill: [0.714, 0.143, 254.6], fg: [0.237, 0.059, 259] },
	warning: { fill: [0.837, 0.164, 84.4], fg: [0.216, 0.006, 56] },
	error: { fill: [0.711, 0.166, 22.2], fg: [0.205, 0.057, 23.5] },
	success: { fill: [0.8, 0.182, 151.7], fg: [0.266, 0.063, 152.9] },
} as const

const WCAG_AA_NORMAL = 4.5

describe('theme contrast — WCAG AA for UX-state tokens (≥ 4.5:1)', () => {
	describe('light mode', () => {
		for (const [name, { fill, fg }] of Object.entries(LIGHT_MODE_TOKENS)) {
			test(`${name} foreground on ${name} fill passes WCAG AA`, () => {
				const fillLum = oklchToLuminance(...fill)
				const fgLum = oklchToLuminance(...fg)
				const ratio = contrastRatio(fillLum, fgLum)
				expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL)
			})
		}
	})

	describe('dark mode', () => {
		for (const [name, { fill, fg }] of Object.entries(DARK_MODE_TOKENS)) {
			test(`${name} foreground on ${name} fill passes WCAG AA`, () => {
				const fillLum = oklchToLuminance(...fill)
				const fgLum = oklchToLuminance(...fg)
				const ratio = contrastRatio(fillLum, fgLum)
				expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL)
			})
		}
	})
})
