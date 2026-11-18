import { STOREFRONT_THEME_LIST, storefrontThemeSwatchColors, type StorefrontThemeDefinition } from '@/config/storefrontThemes'
import type { StorefrontThemeId } from '@/lib/schemas/storefront'
import { cn } from '@/lib/utils'
import { Check } from 'lucide-react'

/**
 * The theme picker grid. Used in two places with the same visual language on
 * purpose: the Puck sidebar's root "Theme" field (change it any time while
 * editing) and step 2 of the setup wizard (pick one before you start). One
 * component means the two can never drift into looking like different
 * features.
 */
export function ThemeSwatchGrid({
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
			<span className="text-xs text-muted-foreground">{theme.description}</span>
		</button>
	)
}
