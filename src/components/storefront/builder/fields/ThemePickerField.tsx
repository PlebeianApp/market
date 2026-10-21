import {
	STOREFRONT_THEMES,
	STOREFRONT_THEME_LIST,
	STOREFRONT_TUNE_AXES,
	getStorefrontPalette,
	getStorefrontTheme,
	normalizeStorefrontTune,
	storefrontPaletteSwatchColors,
	storefrontThemeSwatchColors,
	storefrontTuneWord,
	type StorefrontThemeDefinition,
	type StorefrontThemeTune,
	type StorefrontTuneAxis,
} from '@/config/storefrontThemes'
import type { StorefrontThemeId } from '@/lib/schemas/storefront'
import { cn } from '@/lib/utils'
import { Check, RotateCcw, Wand2 } from 'lucide-react'

/**
 * The theme picker.
 *
 * Modelled on the Plebeian Theme Studio (plebeian-theme-studio.pplx.app), which
 * walks the author through three steps — pick a layout, choose colours, make it
 * yours — and then exports one small `plebeian.site-theme` object. This file
 * reproduces that flow: the same three steps, the same six tune axes, and the
 * same value-band words ("Sharp … Pebble"), so the two surfaces read as one
 * feature rather than two.
 *
 * Everything here is presentational. It reads the registry, reports the
 * author's choice, and never invents a value — every number it can produce is
 * clamped by `normalizeStorefrontTune`. `ThemeSwatchGrid` is kept as the export
 * name `storefrontCms.tsx` and the wizard already import; it is now the step-1
 * gallery, and `ThemeSwatchCard` keeps its old signature.
 */

/** A layout card in step 1. */
export function ThemeSwatchCard({
	theme,
	selected,
	disabled,
	onSelect,
}: {
	theme: StorefrontThemeDefinition
	selected: boolean
	disabled?: boolean
	onSelect: () => void
}) {
	return (
		<button
			type="button"
			onClick={onSelect}
			disabled={disabled}
			aria-pressed={selected}
			data-testid={`storefront-theme-${theme.id}`}
			className={cn(
				'flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
				selected ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary/50',
			)}
		>
			<div className="flex items-center justify-between gap-2">
				<span className="truncate text-sm font-medium text-foreground">{theme.label}</span>
				{selected && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
			</div>
			<div className="flex gap-1">
				{storefrontThemeSwatchColors(theme).map((color, index) => (
					<span key={index} className="size-5 rounded-full border border-black/10" style={{ background: color }} aria-hidden />
				))}
			</div>
			<span className="text-xs font-medium text-muted-foreground">{theme.forWho}</span>
			<span className="text-xs text-muted-foreground">{theme.description}</span>
			<span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
				{theme.fonts} · {theme.palettes.length} colourways
			</span>
		</button>
	)
}

/** Step 1 — "Pick a layout". */
export function ThemeLayoutGallery({
	value,
	onChange,
	readOnly,
}: {
	value: StorefrontThemeId
	onChange: (id: StorefrontThemeId) => void
	readOnly?: boolean
}) {
	return (
		<div className="grid grid-cols-1 gap-2">
			{STOREFRONT_THEME_LIST.map((theme) => (
				<ThemeSwatchCard
					key={theme.id}
					theme={theme}
					selected={theme.id === value}
					disabled={readOnly}
					onSelect={() => onChange(theme.id)}
				/>
			))}
		</div>
	)
}

/**
 * Kept as the export name the CMS config and the setup wizard already import.
 * The root field stores a layout id, so the gallery *is* the theme picker.
 */
export const ThemeSwatchGrid = ThemeLayoutGallery

/** Step 2 — "Choose colours". One curated palette per row, like the studio dock. */
export function ThemePaletteStrip({
	themeId,
	value,
	onChange,
	readOnly,
}: {
	themeId: StorefrontThemeId
	value: string
	onChange: (key: string) => void
	readOnly?: boolean
}) {
	const theme = getStorefrontTheme(themeId)
	return (
		<div className="flex flex-col gap-1.5">
			{theme.palettes.map((palette) => {
				const selected = palette.key === (value || theme.palettes[0].key)
				return (
					<button
						key={palette.key}
						type="button"
						disabled={readOnly}
						aria-pressed={selected}
						onClick={() => onChange(palette.key)}
						data-testid={`storefront-palette-${palette.key}`}
						className={cn(
							'flex items-center gap-2 rounded-md border p-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
							selected ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary/50',
						)}
					>
						<span className="flex shrink-0 gap-1">
							{storefrontPaletteSwatchColors(palette).map((color, index) => (
								<span key={index} className="size-4 rounded-full border border-black/10" style={{ background: color }} aria-hidden />
							))}
						</span>
						<span className="min-w-0 flex-1 truncate text-xs text-foreground">{palette.label}</span>
						<span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
							{palette.shared ? 'Bold · ' : ''}
							{palette.dark ? 'Dark' : 'Light'}
						</span>
					</button>
				)
			})}
		</div>
	)
}

/** One slider, with the two end words and the current band word. */
function TuneSlider({
	axis,
	value,
	disabled,
	onInput,
}: {
	axis: StorefrontTuneAxis
	value: number
	disabled?: boolean
	onInput: (value: number) => void
}) {
	return (
		<div className="flex flex-col gap-1">
			<label className="flex items-baseline justify-between gap-2 text-xs" htmlFor={`storefront-tune-input-${axis.key}`}>
				<span className="font-medium text-foreground">{axis.label}</span>
				<span className="text-muted-foreground" data-testid={`storefront-tune-word-${axis.key}`}>
					{storefrontTuneWord(axis, value)}
				</span>
			</label>
			<input
				id={`storefront-tune-input-${axis.key}`}
				type="range"
				min={axis.min}
				max={axis.max}
				step={axis.step}
				value={value}
				disabled={disabled}
				data-testid={`storefront-tune-${axis.key}`}
				onChange={(event) => onInput(Number(event.target.value))}
				className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary disabled:cursor-not-allowed"
			/>
			<div className="flex justify-between text-[10px] uppercase tracking-wide text-muted-foreground/70">
				<span>{axis.ends[0]}</span>
				<span>{axis.ends[1]}</span>
			</div>
		</div>
	)
}

/**
 * Step 3 — "Make it yours". Six bounded axes plus the studio's two
 * conveniences: `Reset` back to the layout's own defaults, and `Surprise me`,
 * which nudges each axis by up to ±35% of its span around those defaults —
 * "a nudge, not chaos", in the studio's words.
 */
export function ThemeTunePanel({
	themeId,
	value,
	onChange,
	readOnly,
}: {
	themeId: StorefrontThemeId
	/** Partial is fine: anything missing or out of range resolves to the layout's default. */
	value?: Partial<StorefrontThemeTune>
	onChange: (tune: StorefrontThemeTune) => void
	readOnly?: boolean
}) {
	const theme = getStorefrontTheme(themeId)
	const effective = normalizeStorefrontTune(value, theme.tune)

	return (
		<div className="flex flex-col gap-3">
			{STOREFRONT_TUNE_AXES.map((axis) => (
				<TuneSlider
					key={axis.key}
					axis={axis}
					value={effective[axis.key]}
					disabled={readOnly}
					onInput={(next) => onChange(normalizeStorefrontTune({ ...effective, [axis.key]: next }, theme.tune))}
				/>
			))}
			<p className="text-[10px] text-muted-foreground">
				Hand-made adds slight tilts and uneven corners, so no two pages feel machine-stamped.
			</p>
			<div className="flex gap-1.5">
				<button
					type="button"
					disabled={readOnly}
					onClick={() => onChange({ ...theme.tune })}
					data-testid="storefront-tune-reset"
					className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:border-primary/50 disabled:opacity-60"
				>
					<RotateCcw className="size-3" aria-hidden /> Reset
				</button>
				<button
					type="button"
					disabled={readOnly}
					onClick={() => onChange(surpriseTune(theme.tune))}
					data-testid="storefront-tune-surprise"
					className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:border-primary/50 disabled:opacity-60"
				>
					<Wand2 className="size-3" aria-hidden /> Surprise me
				</button>
			</div>
		</div>
	)
}

/**
 * The studio's `Surprise me`: move each axis a random amount up to 35% of its
 * span away from the layout's own default, then re-clamp. Exotic but in range,
 * so a surprised page is still a page somebody designed.
 *
 * `random` is injectable so a test can pin the outcome.
 */
export function surpriseTune(base: StorefrontThemeTune, random: () => number = Math.random): StorefrontThemeTune {
	const drift: Partial<StorefrontThemeTune> = {}
	for (const axis of STOREFRONT_TUNE_AXES) {
		const span = axis.max - axis.min
		drift[axis.key] = base[axis.key] + (random() - 0.5) * span * 0.7
	}
	return normalizeStorefrontTune(drift, base)
}

/**
 * The whole three-step flow in one control, for surfaces that own all three
 * values at once — the setup wizard, and any future standalone theme editor.
 * The Puck sidebar uses the three steps as separate root fields, so both paths
 * share these components instead of reimplementing them.
 */
export function ThemeStudio({
	theme,
	palette,
	tune,
	onChange,
	readOnly,
}: {
	theme: StorefrontThemeId
	palette: string
	tune: StorefrontThemeTune
	onChange: (next: { theme: StorefrontThemeId; palette: string; tune: StorefrontThemeTune }) => void
	readOnly?: boolean
}) {
	return (
		<div className="flex flex-col gap-4" data-testid="storefront-theme-studio">
			<section className="flex flex-col gap-1.5">
				<h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">1 · Pick a layout</h4>
				<ThemeLayoutGallery
					value={theme}
					readOnly={readOnly}
					onChange={(id) =>
						// Switching layout resets the palette and the tune to that
						// layout's own defaults, as the studio does: a palette key
						// belongs to one layout, and carrying the numbers across would
						// describe a look nobody chose.
						onChange({ theme: id, palette: STOREFRONT_THEMES[id].palettes[0].key, tune: { ...STOREFRONT_THEMES[id].tune } })
					}
				/>
			</section>
			<section className="flex flex-col gap-1.5">
				<h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">2 · Choose colours</h4>
				<ThemePaletteStrip
					themeId={theme}
					value={palette}
					readOnly={readOnly}
					onChange={(key) => onChange({ theme, palette: key, tune })}
				/>
			</section>
			<section className="flex flex-col gap-1.5">
				<h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">3 · Make it yours</h4>
				<ThemeTunePanel themeId={theme} value={tune} readOnly={readOnly} onChange={(next) => onChange({ theme, palette, tune: next })} />
			</section>
		</div>
	)
}

/**
 * The studio's export object, reproduced field for field. This is the whole of
 * what a theme costs to store: page content is untouched, and another client
 * that understands this object can render the same shop.
 */
export function themeStudioExport(themeId: StorefrontThemeId, paletteKey: string, tune: StorefrontThemeTune) {
	const theme = getStorefrontTheme(themeId)
	const palette = getStorefrontPalette(theme, paletteKey)
	return {
		kind: 'plebeian.site-theme' as const,
		version: 1 as const,
		layout: theme.id,
		palette: {
			name: palette.label,
			key: palette.key,
			mode: palette.dark ? ('dark' as const) : ('light' as const),
			...palette.tokens,
			shadow: palette.shadowRgb,
		},
		tune: {
			radius_px: tune.radiusPx,
			shadow: tune.shadow,
			glass: tune.glass,
			spacing: tune.spacing,
			texture: tune.texture,
			handmade: tune.handmade,
		},
	}
}
