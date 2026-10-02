import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { storefrontCmsConfig } from '@/config/storefrontCms'
import {
	STOREFRONT_PAGE_VERSION,
	validateStorefrontPageForPublish,
	type StorefrontPage,
	type StorefrontThemeId,
} from '@/lib/schemas/storefront'
import { cn } from '@/lib/utils'
import { shouldRenderStorefrontPage, useStorefrontPage, usePublishStorefrontPage } from '@/queries/storefront'
import { Puck, type Data } from '@puckeditor/core'
import { ExternalLink, Loader2, Palette } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { StorefrontProvider } from '../StorefrontContext'
import { StorefrontSetupWizard } from './StorefrontSetupWizard'
import { clearStorefrontDraft, loadStorefrontDraft, saveStorefrontDraft } from './draftStorage'

import '@puckeditor/core/puck.css'

/**
 * The page builder.
 *
 * This is a small state machine over three modes:
 *
 *   `loading` — the published page query hasn't settled yet.
 *   `wizard`  — `StorefrontSetupWizard`: pick a template, pick a theme. Shown
 *               whenever there's no usable starting content (a first-time
 *               author, or a document that parsed to zero blocks), and
 *               reachable any time afterward via "Change template".
 *   `editor`  — Puck, seeded from whatever the wizard (or a prior session's
 *               draft, or the published page) produced.
 *
 * Puck owns the canvas, the block list, and the property sidebar once in
 * `editor` mode. This shell owns the things Puck cannot know about: where a
 * page comes from (a relay), where it goes (a signed event), what "saved"
 * means when the destination is a network of relays that may each refuse, and
 * — new in this file — what the author sees before there is anything to edit.
 *
 * Draft handling is deliberately local-first. Every keystroke lands in
 * localStorage, and *nothing* reaches a relay until the author presses Publish
 * — the one network write in the editor. A builder that auto-published would
 * ask the author's signer to approve an event per keystroke and would leave
 * half-finished pages live on their storefront.
 */

type BuilderMode = 'loading' | 'wizard' | 'editor'

/** Puck's `Data` and our document share a shape, so these are projections, not conversions. */
function toPuckData(page: StorefrontPage): Data {
	return { root: { props: page.root.props }, content: page.content } as Data
}

function fromPuckData(data: Data, enabled: boolean): StorefrontPage {
	return {
		version: STOREFRONT_PAGE_VERSION,
		enabled,
		root: { props: (data.root?.props ?? {}) as StorefrontPage['root']['props'] },
		content: data.content as StorefrontPage['content'],
	}
}

export function StorefrontBuilder({ pubkey }: { pubkey: string }) {
	const { data: published, isLoading } = useStorefrontPage(pubkey)
	const publish = usePublishStorefrontPage()

	const [mode, setMode] = useState<BuilderMode>('loading')
	const [initialData, setInitialData] = useState<Data | null>(null)
	const [enabled, setEnabled] = useState(false)
	const [isDirty, setIsDirty] = useState(false)
	const [errors, setErrors] = useState<string[]>([])
	const [confirmChangeTemplateOpen, setConfirmChangeTemplateOpen] = useState(false)

	// The live document. Held in a ref rather than state because Puck fires
	// onChange on every keystroke: re-rendering this shell each time would
	// remount the editor and steal focus mid-word.
	const currentData = useRef<Data | null>(null)

	// Decide the starting mode once, from the draft if there is one, else the
	// published page. Re-deciding after the query settles would discard
	// whatever the author typed while it was in flight.
	const seeded = useRef(false)
	useEffect(() => {
		if (seeded.current || isLoading) return
		seeded.current = true

		const draft = loadStorefrontDraft(pubkey)
		const existing = draft ?? published?.page

		// A document with no blocks is indistinguishable from no document at
		// all as far as the author is concerned — both send them to the setup
		// wizard rather than a blank Puck canvas with nothing to click on.
		if (existing && existing.content.length > 0) {
			setEnabled(existing.enabled)
			setIsDirty(Boolean(draft))
			const data = toPuckData(existing)
			currentData.current = data
			setInitialData(data)
			setMode('editor')
		} else {
			// The `enabled` flag is still taken from the existing document if one
			// exists — arriving at the wizard (e.g. because every block failed to
			// parse) must not quietly switch a previously-live page back on.
			setEnabled(existing?.enabled ?? false)
			setMode('wizard')
		}
	}, [isLoading, published, pubkey])

	const handleWizardComplete = useCallback(
		(page: StorefrontPage) => {
			setEnabled(page.enabled)
			setIsDirty(true)
			const data = toPuckData(page)
			currentData.current = data
			setInitialData(data)
			setErrors([])
			// Persisted immediately: the author's template/theme choice is real
			// work, and a refresh before their first edit inside Puck must not
			// lose it and send them back to the wizard.
			saveStorefrontDraft(pubkey, page)
			setMode('editor')
		},
		[pubkey],
	)

	const handleChange = useCallback(
		(data: Data) => {
			currentData.current = data
			setIsDirty(true)
			setErrors([])
			saveStorefrontDraft(pubkey, fromPuckData(data, enabled))
		},
		[pubkey, enabled],
	)

	const handleToggleEnabled = useCallback(
		(next: boolean) => {
			setEnabled(next)
			setIsDirty(true)
			if (currentData.current) saveStorefrontDraft(pubkey, fromPuckData(currentData.current, next))
		},
		[pubkey],
	)

	const handlePublish = useCallback(
		async (data: Data) => {
			const page = fromPuckData(data, enabled)

			// Strict validation happens here, not at render: a block the renderer
			// would silently drop becomes a message the author can act on while
			// they still have the editor open.
			const validation = validateStorefrontPageForPublish(page)
			if (!validation.ok) {
				setErrors(validation.errors)
				toast.error('Fix the highlighted problems before publishing')
				return
			}
			setErrors([])

			try {
				const result = await publish.mutateAsync(validation.page)
				clearStorefrontDraft(pubkey)
				setIsDirty(false)
				// Report the relays that actually acknowledged. "Published" on its
				// own would be a claim about retention we cannot make.
				toast.success(
					enabled
						? `Page published to ${result.publishedRelays.length} relay${result.publishedRelays.length === 1 ? '' : 's'}`
						: `Saved to ${result.publishedRelays.length} relay${result.publishedRelays.length === 1 ? '' : 's'} (page is switched off)`,
				)
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Could not publish the page'
				setErrors([message])
				toast.error(message)
			}
		},
		[enabled, publish, pubkey],
	)

	const handleDiscardDraft = useCallback(() => {
		clearStorefrontDraft(pubkey)
		const page = published?.page

		if (page && page.content.length > 0) {
			setEnabled(page.enabled)
			const data = toPuckData(page)
			currentData.current = data
			setInitialData(data)
			setMode('editor')
		} else {
			// Nothing published to fall back to either — the only honest
			// "discard" is to send the author back to step one.
			setEnabled(false)
			currentData.current = null
			setInitialData(null)
			setMode('wizard')
		}
		setIsDirty(false)
		setErrors([])
		toast.success('Unpublished changes discarded')
	}, [published, pubkey])

	// Reopening the wizard always asks first: `finish()` there REPLACES the
	// whole block list, and there is no separate "are you sure" inside the
	// wizard itself (its own Back/Cancel are about navigating the wizard, not
	// about the data loss this specific entry point risks).
	const requestChangeTemplate = useCallback(() => setConfirmChangeTemplateOpen(true), [])
	const confirmChangeTemplate = useCallback(() => {
		setConfirmChangeTemplateOpen(false)
		setMode('wizard')
	}, [])

	const isLive = shouldRenderStorefrontPage(published)
	const currentThemeId = (currentData.current?.root?.props as { theme?: StorefrontThemeId } | undefined)?.theme

	// `renderHeaderActions` REPLACES Puck's default action area, Publish button
	// included — so this has to supply its own. That suits us anyway: publishing
	// here is a signing operation with a pending state and a relay-count result,
	// none of which Puck's generic button can express.
	const headerActions = useMemo(
		() =>
			function HeaderActions() {
				return (
					<div className="flex flex-wrap items-center gap-2" data-testid="storefront-builder-actions">
						<label className="flex items-center gap-2 text-sm font-medium whitespace-nowrap">
							<Switch
								checked={enabled}
								onCheckedChange={handleToggleEnabled}
								aria-label="Use this page as my public profile"
								data-testid="storefront-enable-toggle"
							/>
							Public
						</label>

						{isLive && (
							<a
								href={`/profile/${pubkey}`}
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex items-center gap-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground hover:text-foreground"
							>
								View live <ExternalLink className="size-3.5" />
							</a>
						)}

						<Button
							variant="ghost"
							size="sm"
							onClick={requestChangeTemplate}
							disabled={publish.isPending}
							data-testid="storefront-change-template"
						>
							<Palette className="mr-1.5 size-3.5" /> Change template
						</Button>

						{isDirty && (
							<Button
								variant="ghost"
								size="sm"
								onClick={handleDiscardDraft}
								disabled={publish.isPending}
								data-testid="storefront-discard-draft"
							>
								Discard
							</Button>
						)}

						<Button
							size="sm"
							onClick={() => currentData.current && handlePublish(currentData.current)}
							disabled={publish.isPending}
							data-testid="storefront-publish"
						>
							{publish.isPending && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
							Publish
						</Button>
					</div>
				)
			},
		[enabled, handleToggleEnabled, isLive, pubkey, isDirty, handleDiscardDraft, handlePublish, publish.isPending, requestChangeTemplate],
	)

	if (mode === 'loading') {
		return (
			<div className="flex min-h-96 items-center justify-center">
				<Loader2 className="size-6 animate-spin text-muted-foreground" />
			</div>
		)
	}

	if (mode === 'wizard') {
		return (
			<StorefrontSetupWizard
				pubkey={pubkey}
				initialThemeId={currentThemeId}
				// Only offer a way back out when there's an editor session to
				// return to — true first-time setup has nothing to cancel to.
				onCancel={initialData ? () => setMode('editor') : undefined}
				onComplete={handleWizardComplete}
			/>
		)
	}

	if (!initialData) {
		// Unreachable in practice — `editor` mode is only entered with
		// `initialData` set — but keeps this component total rather than
		// asserting at the Puck call below.
		return null
	}

	return (
		// The provider wraps Puck rather than just the canvas so the sidebar's
		// product and collection pickers resolve against the same author.
		<StorefrontProvider value={{ pubkey, isEditing: true }}>
			<div className="flex h-full min-h-[70vh] flex-col">
				{errors.length > 0 && (
					<div
						role="alert"
						data-testid="storefront-publish-errors"
						className="border-b border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
					>
						<p className="font-semibold">This page was not published:</p>
						<ul className="mt-1 list-disc space-y-0.5 pl-5">
							{errors.map((error) => (
								<li key={error}>{error}</li>
							))}
						</ul>
					</div>
				)}

				<div className={cn('flex-1', publish.isPending && 'pointer-events-none opacity-60')} data-testid="storefront-builder">
					<Puck
						config={storefrontCmsConfig}
						data={initialData}
						onChange={handleChange}
						onPublish={handlePublish}
						renderHeaderActions={headerActions}
						headerTitle="Your storefront"
						// Rendering inline instead of in an iframe keeps the canvas
						// inside the app's own stylesheet and React tree, so blocks
						// look in the editor exactly as they will on the page.
						iframe={{ enabled: false }}
						height="100%"
					/>
				</div>
			</div>

			<ChangeTemplateDialog
				open={confirmChangeTemplateOpen}
				onOpenChange={setConfirmChangeTemplateOpen}
				onConfirm={confirmChangeTemplate}
			/>
		</StorefrontProvider>
	)
}

function ChangeTemplateDialog({
	open,
	onOpenChange,
	onConfirm,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	onConfirm: () => void
}) {
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Start over from a template?</AlertDialogTitle>
					<AlertDialogDescription>
						Picking a new template replaces every block currently on the canvas. This only affects your draft — nothing is published until
						you press Publish, so your live page (if you have one) stays exactly as it is until then.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Keep editing</AlertDialogCancel>
					<AlertDialogAction onClick={onConfirm} data-testid="storefront-change-template-confirm">
						Choose a different template
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
