import { Button } from '@/components/ui/button'
import {
	STOREFRONT_TEMPLATES,
	getStorefrontTemplate,
	instantiateStorefrontTemplate,
	type StorefrontTemplateId,
} from '@/config/storefrontTemplates'
import { getStorefrontTheme, normalizeStorefrontTune } from '@/config/storefrontThemes'
import { createEmptyStorefrontPage, type StorefrontPage, type StorefrontThemeId, type StorefrontThemeTune } from '@/lib/schemas/storefront'
import { cn } from '@/lib/utils'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import { useMemo, useState } from 'react'
import { StorefrontProvider } from '../StorefrontContext'
import { StorefrontBlockView, StorefrontRoot } from '../StorefrontRenderer'
import { ThemeStudio } from './fields/ThemePickerField'

/**
 * The two-step page setup wizard: choose a template, then choose a theme.
 *
 * Both steps render **real** previews through `StorefrontBlockView` /
 * `StorefrontRoot` — the same components the published page and the Puck
 * canvas use — scaled down inside an `overflow-hidden` frame rather than drawn
 * as mockup art. A template preview showing `ProductGrid` therefore shows the
 * author's actual listings, not a stock photo standing in for them. This is
 * the same "the canvas is the renderer, not a preview of it" principle
 * `storefrontCms.tsx` documents, extended one step earlier.
 *
 * The wizard produces a `StorefrontPage` and hands it to `onComplete` — it
 * does not publish anything itself. Everything it picks (template, theme)
 * stays fully editable afterward in the normal builder; this only decides
 * what the author starts from.
 */

const STEPS = ['template', 'theme'] as const
type WizardStep = (typeof STEPS)[number]

const STEP_LABEL: Record<WizardStep, string> = {
	template: 'Choose a template',
	theme: 'Choose a theme',
}

export interface StorefrontSetupWizardProps {
	pubkey: string
	/** Pre-selects a starting point — used when "Change template" reopens the wizard over an existing page. */
	initialTemplateId?: StorefrontTemplateId
	initialThemeId?: StorefrontThemeId
	/**
	 * Reopening over a page that already has a look carries its colourway and
	 * fine-tuning back in, so step 2 starts from what the author chose rather
	 * than from the layout's defaults.
	 */
	initialPaletteKey?: string
	initialTune?: StorefrontThemeTune
	onComplete: (page: StorefrontPage) => void
	/** Omitted on first-time setup, where there is nothing yet to cancel back to. */
	onCancel?: () => void
}

export function StorefrontSetupWizard({
	pubkey,
	initialTemplateId = 'shop',
	initialThemeId,
	initialPaletteKey,
	initialTune,
	onComplete,
	onCancel,
}: StorefrontSetupWizardProps) {
	const startingThemeId = initialThemeId ?? getStorefrontTemplate(initialTemplateId).defaultThemeId
	const startingTheme = getStorefrontTheme(startingThemeId)
	const [step, setStep] = useState<WizardStep>('template')
	const [templateId, setTemplateId] = useState<StorefrontTemplateId>(initialTemplateId)
	const [themeId, setThemeId] = useState<StorefrontThemeId>(startingThemeId)
	const [paletteKey, setPaletteKey] = useState<string>(initialPaletteKey || startingTheme.palettes[0].key)
	const [tune, setTune] = useState<StorefrontThemeTune>(normalizeStorefrontTune(initialTune, startingTheme.tune))

	const stepIndex = STEPS.indexOf(step)
	const template = getStorefrontTemplate(templateId)
	const theme = getStorefrontTheme(themeId)

	// A fresh instantiation per template/step change, not per keystroke — there
	// are none here, only button clicks, so recomputing this is cheap and keeps
	// the preview blocks' ids stable while the author lingers on one step.
	const previewBlocks = useMemo(() => instantiateStorefrontTemplate(template), [template])

	/**
	 * Switching layout resets the colourway and the tuning to that layout's own
	 * defaults, matching the studio: a palette key belongs to one layout, and
	 * carrying the numbers across would describe a look nobody chose.
	 */
	const applyTheme = (id: StorefrontThemeId) => {
		const next = getStorefrontTheme(id)
		setThemeId(id)
		setPaletteKey(next.palettes[0].key)
		setTune({ ...next.tune })
	}

	const selectTemplate = (id: StorefrontTemplateId) => {
		setTemplateId(id)
		// Carry the newly-picked template's suggested theme into step 2 as the
		// starting point — the author can still override it there.
		applyTheme(getStorefrontTemplate(id).defaultThemeId)
	}

	const finish = () => {
		const page: StorefrontPage = {
			...createEmptyStorefrontPage(),
			root: { props: { title: '', theme: themeId, palette: paletteKey, tune } },
			content: instantiateStorefrontTemplate(template),
		}
		onComplete(page)
	}

	return (
		<StorefrontProvider value={{ pubkey, isEditing: true }}>
			<div className="mx-auto flex min-h-[70vh] w-full max-w-5xl flex-col gap-6 p-4 sm:p-6" data-testid="storefront-wizard">
				<ol className="flex flex-wrap items-center gap-2 text-sm font-medium text-muted-foreground" aria-label="Setup steps">
					{STEPS.map((s, i) => (
						<li key={s} className="flex items-center gap-2">
							<span
								className={cn(
									'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs',
									i === stepIndex
										? 'border-primary bg-primary text-primary-foreground'
										: i < stepIndex
											? 'border-primary text-primary'
											: 'border-border',
								)}
								aria-hidden
							>
								{i < stepIndex ? <Check className="size-3.5" /> : i + 1}
							</span>
							<span className={i === stepIndex ? 'text-foreground' : undefined}>{STEP_LABEL[s]}</span>
							{i < STEPS.length - 1 && <span className="h-px w-6 bg-border sm:w-10" aria-hidden />}
						</li>
					))}
				</ol>

				{step === 'template' && (
					<div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2" role="radiogroup" aria-label="Template">
						{STOREFRONT_TEMPLATES.map((candidate) => (
							<TemplateCard
								key={candidate.id}
								id={candidate.id}
								label={candidate.label}
								description={candidate.description}
								themeId={getStorefrontTemplate(candidate.id).defaultThemeId}
								selected={candidate.id === templateId}
								onSelect={() => selectTemplate(candidate.id)}
							/>
						))}
					</div>
				)}

				{step === 'theme' && (
					<div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
						{/* The studio's three steps, reused verbatim from the builder
						    sidebar — one component means the wizard and the editor can
						    never offer different-looking theme controls. */}
						<ThemeStudio
							theme={themeId}
							palette={paletteKey}
							tune={tune}
							onChange={({ theme: nextTheme, palette: nextPalette, tune: nextTune }) => {
								setThemeId(nextTheme)
								setPaletteKey(nextPalette)
								setTune(nextTune)
							}}
						/>

						<div className="flex min-w-0 flex-col gap-3">
							{/* The template chosen in step 1, rendered with the look chosen
							    here — the moment that makes "this template, with this look"
							    concrete before the author commits to it. */}
							<p className="text-sm text-muted-foreground">
								<span className="font-medium text-foreground">{theme.label}</span> · {theme.forWho} ·{' '}
								{theme.palettes.find((p) => p.key === paletteKey)?.label ?? theme.palettes[0].label}
							</p>
							<div className="overflow-hidden rounded-lg border border-border">
								{previewBlocks.length > 0 ? (
									<div className="pointer-events-none" aria-hidden>
										<StorefrontRoot props={{ title: '', theme: themeId, palette: paletteKey, tune }} fullHeight={false}>
											{previewBlocks.slice(0, 2).map((block) => (
												<StorefrontBlockView key={block.props.id} block={block} />
											))}
										</StorefrontRoot>
									</div>
								) : (
									<p className="p-6 text-center text-sm text-muted-foreground">
										A blank page has nothing to preview yet — the theme still applies once you add blocks.
									</p>
								)}
							</div>
						</div>
					</div>
				)}

				<div className="flex items-center justify-between border-t border-border pt-4">
					<div>
						{stepIndex > 0 ? (
							<Button variant="ghost" onClick={() => setStep(STEPS[stepIndex - 1])} data-testid="storefront-wizard-back">
								<ArrowLeft className="mr-1.5 size-4" /> Back
							</Button>
						) : (
							onCancel && (
								<Button variant="ghost" onClick={onCancel} data-testid="storefront-wizard-cancel">
									Cancel
								</Button>
							)
						)}
					</div>
					{stepIndex < STEPS.length - 1 ? (
						<Button onClick={() => setStep(STEPS[stepIndex + 1])} data-testid="storefront-wizard-next">
							Continue <ArrowRight className="ml-1.5 size-4" />
						</Button>
					) : (
						<Button onClick={finish} data-testid="storefront-wizard-finish">
							Use this template
						</Button>
					)}
				</div>
			</div>
		</StorefrontProvider>
	)
}

function TemplateCard({
	id,
	label,
	description,
	themeId,
	selected,
	onSelect,
}: {
	id: StorefrontTemplateId
	label: string
	description: string
	themeId: StorefrontThemeId
	selected: boolean
	onSelect: () => void
}) {
	// Recomputed per card on every render rather than lifted out: cheap (at
	// most 3 blocks), and keeps each card's preview ids independent of
	// whichever template is currently selected.
	const preview = instantiateStorefrontTemplate(getStorefrontTemplate(id)).slice(0, 2)

	return (
		<button
			type="button"
			onClick={onSelect}
			aria-pressed={selected}
			data-testid={`storefront-template-${id}`}
			className={cn(
				'flex flex-col overflow-hidden rounded-lg border text-left transition-colors',
				selected ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary/50',
			)}
		>
			<div className="relative h-36 overflow-hidden bg-muted/40 sm:h-44">
				{preview.length > 0 ? (
					// The preview is the full-size page scaled down with a CSS
					// transform, not a smaller render — `w-[333%]` compensates for
					// `scale-[0.3]` so the content still lays out at (roughly) its
					// normal width before shrinking, rather than reflowing narrow.
					<div className="pointer-events-none absolute left-0 top-0 w-[333%] origin-top-left scale-[0.3]" aria-hidden>
						<StorefrontRoot props={{ title: '', theme: themeId, palette: '', tune: getStorefrontTheme(themeId).tune }} fullHeight={false}>
							{preview.map((block) => (
								<StorefrontBlockView key={block.props.id} block={block} />
							))}
						</StorefrontRoot>
					</div>
				) : (
					<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Empty canvas</div>
				)}
			</div>
			<div className="flex flex-1 flex-col gap-1 p-4">
				<span className="flex items-center gap-2 font-semibold text-foreground">
					{label}
					{selected && <Check className="size-4 text-primary" aria-hidden />}
				</span>
				<span className="text-sm text-muted-foreground">{description}</span>
			</div>
		</button>
	)
}
