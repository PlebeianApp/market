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
	type StorefrontRootProps,
	type StorefrontThemeId,
} from '@/lib/schemas/storefront'
import { cn } from '@/lib/utils'
import { useConfigQuery } from '@/queries/config'
import { getNip05ForPubkey, useNip05Settings } from '@/queries/nip05'
import { useStorefrontPage, usePublishStorefrontPage } from '@/queries/storefront'
import { getVanityForPubkey, useVanitySettings } from '@/queries/vanity'
import { Puck, type Data, usePuck } from '@puckeditor/core'
import {
	ExternalLink,
	Globe2,
	Link2,
	Loader2,
	Maximize2,
	Minimize2,
	PanelLeft,
	PanelRight,
	Palette,
	Redo2,
	Send,
	Undo2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
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

	// The claimed name (if any) is bought on separate dashboard pages today — see
	// ADR-019 — but the builder is where an author actually needs to know it: it
	// decides what "View live page" points at and whether to nudge an author who
	// has never claimed a name at all.
	const { data: config } = useConfigQuery()
	const { data: vanitySettings } = useVanitySettings(config?.appPublicKey)
	const { data: nip05Settings } = useNip05Settings(config?.appPublicKey)
	const vanityEntry = useMemo(() => getVanityForPubkey(vanitySettings, pubkey), [vanitySettings, pubkey])
	const nip05Entry = useMemo(() => getNip05ForPubkey(nip05Settings, pubkey), [nip05Settings, pubkey])
	const liveHref = vanityEntry ? `/${vanityEntry.vanityName}?preview=draft` : `/profile/${pubkey}?preview=draft`

	const [mode, setMode] = useState<BuilderMode>('loading')
	const [initialData, setInitialData] = useState<Data | null>(null)
	const [enabled, setEnabled] = useState(false)
	const [isDirty, setIsDirty] = useState(false)
	const [errors, setErrors] = useState<string[]>([])
	const [confirmChangeTemplateOpen, setConfirmChangeTemplateOpen] = useState(false)
	const [isFullscreen, setIsFullscreen] = useState(false)

	// The live document. Held in a ref rather than state because Puck fires
	// onChange on every keystroke: re-rendering this shell each time would
	// remount the editor and steal focus mid-word.
	const currentData = useRef<Data | null>(null)
	const editorShellRef = useRef<HTMLDivElement | null>(null)

	useEffect(() => {
		const updateFullscreenState = () => setIsFullscreen(document.fullscreenElement === editorShellRef.current)
		document.addEventListener('fullscreenchange', updateFullscreenState)
		return () => document.removeEventListener('fullscreenchange', updateFullscreenState)
	}, [])

	const toggleFullscreen = useCallback(async () => {
		const editorShell = editorShellRef.current
		if (!editorShell) return

		try {
			if (document.fullscreenElement === editorShell) {
				await document.exitFullscreen()
			} else {
				await editorShell.requestFullscreen()
			}
		} catch {
			toast.error('Fullscreen mode is unavailable in this browser')
		}
	}, [])

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

	// The page's current look, so reopening the wizard starts from what the
	// author already chose rather than from the new template's defaults.
	const currentRootProps = (currentData.current?.root?.props ?? {}) as Partial<StorefrontRootProps>
	const currentThemeId = currentRootProps.theme

	// The header-actions override keeps storefront visibility and the explicit
	// publish flow together. The full header override lays them out in the
	// two-row dashboard toolbar.
	const headerActionsOverride = useMemo(
		() =>
			function StorefrontHeaderActions() {
				return (
					<div className="flex flex-wrap items-center justify-end gap-2" data-testid="storefront-builder-actions">
						<div
							className="flex shrink-0 items-center gap-1 rounded-lg border bg-background p-1"
							role="group"
							aria-label="Storefront visibility"
						>
							<label className="inline-flex h-8 items-center gap-2 rounded-md px-2 text-sm font-medium whitespace-nowrap">
								<Globe2 className="size-4 text-muted-foreground" aria-hidden="true" />
								<span>{enabled ? 'Public' : 'Private'}</span>
								<Switch
									checked={enabled}
									onCheckedChange={handleToggleEnabled}
									aria-label="Make this storefront public"
									data-testid="storefront-enable-toggle"
									size="sm"
								/>
							</label>
						</div>

						<Button
							size="lg"
							className="shrink-0"
							onClick={() => currentData.current && handlePublish(currentData.current)}
							disabled={publish.isPending}
							data-testid="storefront-publish"
						>
							{publish.isPending ? (
								<Loader2 className="size-4 animate-spin" aria-hidden="true" />
							) : (
								<Send className="size-4" aria-hidden="true" />
							)}
							Publish
						</Button>
					</div>
				)
			},
		[enabled, handleToggleEnabled, handlePublish, publish.isPending],
	)

	const headerOverride = useMemo(
		() =>
			function StorefrontEditorHeader({ actions }: { actions: ReactNode }) {
				const hostname = typeof window !== 'undefined' ? window.location.hostname : ''
				const { appState, dispatch, history } = usePuck()
				const leftSidebarVisible = appState.ui.leftSideBarVisible
				const rightSidebarVisible = appState.ui.rightSideBarVisible
				const leftSidebarLabel = leftSidebarVisible ? 'Hide blocks sidebar' : 'Show blocks sidebar'
				const rightSidebarLabel = rightSidebarVisible ? 'Hide settings sidebar' : 'Show settings sidebar'
				const fullscreenLabel = isFullscreen ? 'Exit full screen' : 'Enter full screen'

				const toggleSidebar = (sidebar: 'left' | 'right') => {
					const isWideViewport = window.matchMedia('(min-width: 638px)').matches
					if (sidebar === 'left') {
						const nextVisible = !leftSidebarVisible
						dispatch({
							type: 'setUi',
							ui:
								isWideViewport || !nextVisible
									? { leftSideBarVisible: nextVisible }
									: { leftSideBarVisible: true, rightSideBarVisible: false },
						})
					} else {
						const nextVisible = !rightSidebarVisible
						dispatch({
							type: 'setUi',
							ui:
								isWideViewport || !nextVisible
									? { rightSideBarVisible: nextVisible }
									: { rightSideBarVisible: true, leftSideBarVisible: false },
						})
					}
				}

				return (
					<header
						data-testid="storefront-editor-header"
						className="w-full border-b bg-background text-foreground shadow-sm"
						style={{ gridArea: 'header' }}
					>
						<div
							data-testid="storefront-header-top-row"
							className="grid grid-cols-1 items-center gap-3 border-b px-4 py-3 sm:grid-cols-[1fr_auto_1fr]"
						>
							<div className="flex flex-col items-start gap-1">
								<Button variant="outline" size="sm" asChild data-testid="storefront-view-live">
									<a href={liveHref} target="_blank" rel="noopener noreferrer">
										View live page <ExternalLink className="size-3.5" aria-hidden="true" />
									</a>
								</Button>
								<div className="flex items-center gap-1 pl-1 text-xs text-muted-foreground" data-testid="storefront-identity">
									<Link2 className="size-3" aria-hidden="true" />
									{vanityEntry || nip05Entry ? (
										<span>
											{[vanityEntry && `${hostname}/${vanityEntry.vanityName}`, nip05Entry && `${nip05Entry.username}@${hostname}`]
												.filter(Boolean)
												.join(' · ')}
										</span>
									) : (
										<a
											href="/dashboard/account/vanity-url"
											className="underline decoration-dotted hover:text-foreground"
											data-testid="storefront-claim-identity"
										>
											Claim a custom URL &amp; Nostr address
										</a>
									)}
								</div>
							</div>
							<h1 className="text-center text-base font-semibold tracking-tight sm:text-lg">Your Storefront</h1>
							<div className="flex min-w-0 justify-center sm:justify-end">{actions}</div>
						</div>

						<div
							data-testid="storefront-header-toolbar-row"
							className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-4"
						>
							<div className="flex items-center gap-1" role="group" aria-label="Editor history and layout">
								<Button
									variant="ghost"
									size="icon-sm"
									title={leftSidebarLabel}
									aria-label={leftSidebarLabel}
									aria-pressed={leftSidebarVisible}
									data-testid="storefront-sidebar-toggle"
									onClick={() => toggleSidebar('left')}
								>
									<PanelLeft className="size-4" aria-hidden="true" />
								</Button>
								<Button
									variant="ghost"
									size="icon-sm"
									title={rightSidebarLabel}
									aria-label={rightSidebarLabel}
									aria-pressed={rightSidebarVisible}
									data-testid="storefront-right-sidebar-toggle"
									onClick={() => toggleSidebar('right')}
								>
									<PanelRight className="size-4" aria-hidden="true" />
								</Button>
								<Button
									variant="ghost"
									size="icon-sm"
									title="Undo"
									aria-label="Undo"
									disabled={!history.hasPast}
									data-testid="storefront-undo"
									onClick={history.back}
								>
									<Undo2 className="size-4" aria-hidden="true" />
								</Button>
								<Button
									variant="ghost"
									size="icon-sm"
									title="Redo"
									aria-label="Redo"
									disabled={!history.hasFuture}
									data-testid="storefront-redo"
									onClick={history.forward}
								>
									<Redo2 className="size-4" aria-hidden="true" />
								</Button>
							</div>

							<div className="ml-auto flex flex-wrap items-center justify-end gap-1">
								<Button
									variant="ghost"
									size="icon-sm"
									title={fullscreenLabel}
									aria-label={fullscreenLabel}
									aria-pressed={isFullscreen}
									data-testid="storefront-fullscreen-toggle"
									onClick={toggleFullscreen}
								>
									{isFullscreen ? <Minimize2 className="size-4" aria-hidden="true" /> : <Maximize2 className="size-4" aria-hidden="true" />}
								</Button>
								<Button
									variant="ghost"
									size="sm"
									onClick={requestChangeTemplate}
									disabled={publish.isPending}
									data-testid="storefront-change-template"
								>
									<Palette className="size-4" aria-hidden="true" /> Change template
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
							</div>
						</div>
					</header>
				)
			},
		[
			handleDiscardDraft,
			isDirty,
			isFullscreen,
			liveHref,
			nip05Entry,
			publish.isPending,
			requestChangeTemplate,
			toggleFullscreen,
			vanityEntry,
		],
	)

	const scrollableFieldsOverride = useMemo(
		() =>
			function ScrollableFields({ children }: { children: ReactNode }) {
				return (
					<div className="h-full min-h-0 overflow-y-auto overscroll-y-contain" data-testid="storefront-settings-scroll-area">
						{children}
					</div>
				)
			},
		[],
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
				initialPaletteKey={currentRootProps.palette}
				initialTune={currentRootProps.tune}
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
			<div
				ref={editorShellRef}
				className={cn('flex h-full min-h-[70vh] flex-col', isFullscreen && 'h-screen min-h-0 w-screen overflow-auto bg-background')}
			>
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
						overrides={{ header: headerOverride, headerActions: headerActionsOverride, fields: scrollableFieldsOverride }}
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
