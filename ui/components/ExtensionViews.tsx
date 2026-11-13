import { ChevronRight, ExternalLink, ImageIcon, Link2, Pause, Pencil, Play, Plus, Puzzle, Sparkles, Store, Trash2 } from 'lucide-react'
import { cloneElement, useState, type FormEvent, type ReactElement, type ReactNode } from 'react'
import { actionNameProblem, capabilityProblem } from '@sdk/core/extensions'
import type {
	ExtensionCatalog,
	ExtensionCatalogEntry,
	ExtensionCatalogState,
	ExtensionHostPortName,
	PublicExtensionDescriptor,
	RemoteBindingRequest,
	RemoteBindingView,
	RepositoryExtensionEntry,
	RepositorySnapshot,
	RepositoryTool,
	SuggestedBinding,
} from '@sdk/core/extensions'
import { Badge } from '../primitives/badge'
import { Button } from '../primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../primitives/card'
import { Input } from '../primitives/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../primitives/dialog'
import { Label } from '../primitives/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../primitives/tabs'
import { Textarea } from '../primitives/textarea'

/** Extension logo with a neutral fallback when the descriptor carries none. */
export function ExtensionLogo({ icon, name, size = 48 }: { icon?: string; name: string; size?: number }) {
	if (!icon) {
		return (
			<div
				className="flex shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500"
				style={{ width: size, height: size }}
				aria-hidden="true"
			>
				<Puzzle className="h-1/2 w-1/2" />
			</div>
		)
	}
	return <img src={icon} alt={`${name} logo`} width={size} height={size} className="shrink-0 rounded-xl" loading="lazy" />
}

export function ExtensionCard({ descriptor }: { descriptor: PublicExtensionDescriptor }) {
	return (
		<Card data-testid={`extension-card-${descriptor.id}`}>
			<CardHeader className="flex flex-row items-start gap-4 space-y-0">
				<ExtensionLogo icon={descriptor.icon} name={descriptor.displayName} />
				<div className="min-w-0 flex-1">
					<CardTitle className="flex flex-wrap items-center gap-2 text-lg">
						{descriptor.displayName}
						<Badge variant="secondary">v{descriptor.version}</Badge>
						<Badge variant="outline" className="border-green-600 text-green-700">
							Enabled
						</Badge>
					</CardTitle>
					<CardDescription className="break-all font-mono text-xs">{descriptor.id}</CardDescription>
				</div>
			</CardHeader>
			<CardContent className="space-y-3 text-sm">
				<div>
					<div className="mb-1 font-medium">Capabilities</div>
					<div className="flex flex-wrap gap-1">
						{descriptor.capabilities.map((capability) => (
							<Badge key={capability} variant="outline" className="font-mono">
								{capability}
							</Badge>
						))}
					</div>
				</div>
				{descriptor.actions.length > 0 && (
					<div>
						<div className="mb-1 font-medium">Actions</div>
						<ul className="space-y-1">
							{descriptor.actions.map((action) => (
								<li key={action.name} className="text-muted-foreground">
									<span className="font-mono text-foreground">{action.name}</span>
									{action.description ? ` — ${action.description}` : ''}
									<span className="block text-xs">
										{action.auth === 'admin' ? 'Admins only' : 'Any signed-in user'} · {action.rateLimit.perPubkey} calls per{' '}
										{formatWindow(action.rateLimit.windowSeconds)} · {action.transports.join(', ')}
									</span>
								</li>
							))}
						</ul>
					</div>
				)}
			</CardContent>
		</Card>
	)
}

export function ExtensionsEmptyState() {
	return (
		<Card>
			<CardContent className="space-y-2 py-8 text-center">
				<Puzzle className="mx-auto h-10 w-10 text-muted-foreground" />
				<p className="font-medium">No extensions added yet.</p>
				<p className="text-sm text-muted-foreground">Add one from the Extension store.</p>
			</CardContent>
		</Card>
	)
}

export interface ExtensionTileProps {
	name: string
	icon?: string
	kind: 'built-in' | 'external'
	/** What the extension does, in one line. */
	description?: string
	/** Short line under the name, e.g. "2 actions". */
	subtitle?: string
	/** Optional status shown when the extension needs attention. */
	warning?: string
	/** Router link to the extension's page; the tile renders inside it (cloned), since `ui/` cannot import the router. */
	link: ReactElement<{ className?: string; children?: ReactNode }>
	testId?: string
}

/** One added extension on the Extensions page; the whole tile is the link to its page. */
export function ExtensionTile({ name, icon, kind, description, subtitle, warning, link, testId }: ExtensionTileProps) {
	return cloneElement(
		link,
		{
			className:
				'flex items-center gap-3 rounded-lg border bg-white p-3 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
			...(testId ? { 'data-testid': testId } : {}),
		} as Partial<{ className: string }>,
		<>
			<ExtensionLogo icon={icon} name={name} size={40} />
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-2">
					<span className="truncate font-medium">{name}</span>
					<Badge variant="outline" className={kind === 'external' ? 'border-sky-500 text-sky-700' : undefined}>
						{kind === 'external' ? 'External' : 'Built-in'}
					</Badge>
					{warning && (
						<Badge variant="outline" className="border-amber-500 text-amber-700">
							{warning}
						</Badge>
					)}
				</div>
				{description && (
					<p className="line-clamp-2 text-sm text-muted-foreground" title={description}>
						{description}
					</p>
				)}
				{subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
			</div>
			<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
		</>,
	)
}

export interface ImageDescribeRequest {
	imageUrl: string
	title?: string
	notes?: string
}

export interface ImageDescribeResult {
	description: string
	provider: string
	mock: boolean
}

export interface ImageDescribePanelProps {
	onDescribe: (request: ImageDescribeRequest) => void
	pending: boolean
	result?: ImageDescribeResult
	errorMessage?: string
}

/** Try-it panel for the `product.image.describe` capability. Output is a draft; nothing is published. */
export function ImageDescribePanel({ onDescribe, pending, result, errorMessage }: ImageDescribePanelProps) {
	const [imageUrl, setImageUrl] = useState('')
	const [title, setTitle] = useState('')
	const [notes, setNotes] = useState('')
	const previewable = /^https?:\/\//i.test(imageUrl.trim())

	const submit = (event: FormEvent) => {
		event.preventDefault()
		if (!imageUrl.trim() || pending) return
		onDescribe({ imageUrl: imageUrl.trim(), title: title.trim() || undefined, notes: notes.trim() || undefined })
	}

	return (
		<Card data-testid="image-describe-panel">
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-lg">
					<ImageIcon className="h-5 w-5" /> Describe a product image
				</CardTitle>
				<CardDescription>Your request is signed with your Nostr key and sent to this marketplace's server.</CardDescription>
			</CardHeader>
			<CardContent>
				<form onSubmit={submit} className="grid gap-4 md:grid-cols-[1fr_160px]">
					<div className="space-y-3">
						<div className="space-y-1">
							<Label htmlFor="describe-image-url">Image URL</Label>
							<Input
								id="describe-image-url"
								data-testid="describe-image-url"
								placeholder="https://…/walnut-cutting-board.jpg"
								value={imageUrl}
								onChange={(event) => setImageUrl(event.target.value)}
								required
							/>
						</div>
						<div className="space-y-1">
							<Label htmlFor="describe-image-title">Product title (optional)</Label>
							<Input
								id="describe-image-title"
								data-testid="describe-image-title"
								value={title}
								maxLength={200}
								onChange={(event) => setTitle(event.target.value)}
							/>
						</div>
						<div className="space-y-1">
							<Label htmlFor="describe-image-notes">Notes (optional)</Label>
							<Textarea
								id="describe-image-notes"
								data-testid="describe-image-notes"
								value={notes}
								maxLength={500}
								rows={2}
								onChange={(event) => setNotes(event.target.value)}
							/>
						</div>
						<Button type="submit" disabled={pending || !imageUrl.trim()} data-testid="describe-image-submit">
							<Sparkles className="mr-2 h-4 w-4" />
							{pending ? 'Describing…' : 'Describe image'}
						</Button>
					</div>
					<div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border bg-zinc-50">
						{previewable ? (
							<img src={imageUrl.trim()} alt="Preview" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
						) : (
							<ImageIcon className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
						)}
					</div>
				</form>

				{errorMessage && (
					<p role="alert" className="mt-4 text-sm text-red-600" data-testid="describe-image-error">
						{errorMessage}
					</p>
				)}
				{result && (
					<div className="mt-4 space-y-2 rounded-lg border bg-zinc-50 p-4" data-testid="describe-image-result">
						<div className="flex items-center gap-2 text-xs text-muted-foreground">
							{result.mock && (
								<Badge variant="outline" className="border-amber-500 text-amber-700">
									Mock-up — no image analysis
								</Badge>
							)}
							<span>Provider: {result.provider}</span>
						</div>
						{/* Extension output is untrusted text: rendered as plain text, never HTML. */}
						<p className="whitespace-pre-wrap text-sm">{result.description}</p>
					</div>
				)}
			</CardContent>
		</Card>
	)
}

/** Top-right entry point to the store page. Pass a router link as `children` to make it navigate (rendered via `asChild`). */
export function ExtensionStoreButton({ children }: { children: ReactElement }) {
	return (
		<Button variant="outline" asChild data-testid="extension-store-button">
			{cloneElement(
				children,
				{},
				<>
					<Store className="mr-2 h-4 w-4" />
					Extension store
				</>,
			)}
		</Button>
	)
}

const STATE_LABELS: Record<ExtensionCatalogState, { label: string; className: string }> = {
	installed_enabled: { label: 'Enabled', className: 'border-green-600 text-green-700' },
	installed_disabled: { label: 'Disabled', className: 'border-zinc-400 text-zinc-600' },
	available: { label: 'Available', className: 'border-zinc-400 text-zinc-600' },
	misconfigured: { label: 'Needs attention', className: 'border-red-500 text-red-600' },
}

const PORT_LABELS: Record<ExtensionHostPortName, string> = {
	'relays:read': 'relays',
	'relays:publish': 'publish',
	http: 'http',
	storage: 'storage',
}

export interface BuiltinControls {
	onToggle: (id: string, enabled: boolean) => void
	pending: boolean
	errorMessage?: string
}

/** Built-in extension row in the store, with an admin Enable/Disable switch. */
export function ExtensionStoreEntry({ entry, controls }: { entry: ExtensionCatalogEntry; controls?: BuiltinControls }) {
	const state = STATE_LABELS[entry.state]
	const enabled = entry.state === 'installed_enabled'
	return (
		<li className="space-y-1 rounded-lg border p-3" data-testid={`extension-store-entry-${entry.id}`}>
			<div className="flex flex-wrap items-center gap-2">
				<ExtensionLogo icon={entry.icon} name={entry.displayName} size={32} />
				<span className="font-medium">{entry.displayName}</span>
				<Badge variant="secondary">v{entry.version}</Badge>
				<Badge variant="outline" className={state.className} data-testid={`extension-store-state-${entry.id}`}>
					{state.label}
				</Badge>
				{entry.hostPorts.map((port) => (
					<Badge key={port} variant="outline" className="font-mono" title={port === 'http' ? entry.egress.join(', ') : undefined}>
						{PORT_LABELS[port]}
					</Badge>
				))}
				{controls && (enabled || entry.canEnable) && (
					<Button
						size="sm"
						variant={enabled ? 'outline' : 'default'}
						className="ml-auto"
						disabled={controls.pending}
						onClick={() => controls.onToggle(entry.id, !enabled)}
						data-testid={`builtin-toggle-${entry.id}`}
					>
						{enabled ? 'Disable' : 'Enable'}
					</Button>
				)}
			</div>
			{entry.description && (
				<p className="line-clamp-2 text-sm text-muted-foreground" title={entry.description}>
					{entry.description}
				</p>
			)}
			{entry.problem && (
				<p role="alert" className="text-xs text-red-600">
					{entry.problem}
				</p>
			)}
			{!enabled && !entry.canEnable && <code className="block text-xs text-muted-foreground">{entry.envPrefix}ENABLED=true</code>}
		</li>
	)
}

/** Add/remove servers on this marketplace. Adding is required before binding a server's tools. */
export interface ServerControls {
	/** Adds a server; with `bindings`, accepts them in the same request (all or none). */
	onAdd: (server: string, bindings?: RemoteBindingRequest[]) => Promise<boolean> | void
	/** Last add failure for a server, shown in its add dialog. */
	addError?: { serverPubkey: string; message: string }
	onRemove: (pubkey: string) => void
	pending: boolean
	errorMessage?: string
}

export interface BindingControls {
	/** Resolves to `true` when the binding was created. */
	onBind: (request: RemoteBindingRequest) => Promise<boolean>
	/** Creates several bindings in one signed request (all or none); resolves to `true` on success. */
	onBindMany?: (requests: RemoteBindingRequest[]) => Promise<boolean>
	/** Last single-bind failure, shown in the matching tool's form. */
	bindError?: { serverPubkey: string; toolName: string; message: string }
	/** Last batch failure, shown in the accept dialog. */
	bindManyError?: { serverPubkey: string; message: string }
	/** Capabilities already used on this marketplace, offered as suggestions in the bind form. */
	capabilitySuggestions?: readonly string[]
	onUpdate: (serverPubkey: string, actionName: string, change: { enabled?: boolean; approveCurrentDefinition?: true }) => void
	onRemove: (serverPubkey: string, actionName: string) => void
	pending: boolean
	errorMessage?: string
}

const DEFAULT_RATE_LIMIT = { perPubkey: 30, windowSeconds: 3600 }

const toRequest = (serverPubkey: string, toolName: string, suggestion: SuggestedBinding): RemoteBindingRequest => ({
	serverPubkey,
	toolName,
	actionName: suggestion.actionName,
	capability: suggestion.capability,
	auth: suggestion.auth,
	rateLimit: DEFAULT_RATE_LIMIT,
	acknowledgedDataFlow: true,
})

/** Unbound, unpaid tools of an added server whose suggestion can be accepted as-is (no action-name collisions). */
export function pendingSuggestedBindings(entry: RepositoryExtensionEntry, bindings: readonly RemoteBindingView[]) {
	return entry.added ? suggestableTools(entry, bindings) : []
}

/** Unpaid, unbound tools with non-colliding suggestions, regardless of whether the server is added yet. */
export function suggestableTools(entry: RepositoryExtensionEntry, bindings: readonly RemoteBindingView[]) {
	if (entry.state !== 'listed') return []
	const taken = new Set(bindings.map((binding) => binding.actionName))
	return entry.tools.filter((tool) => {
		if (tool.price || bindings.some((binding) => binding.toolName === tool.name)) return false
		if (taken.has(tool.suggestedBinding.actionName)) return false
		taken.add(tool.suggestedBinding.actionName)
		return true
	})
}

/**
 * Third-party extension from a registry or added by pubkey. An admin first adds it, then accepts all of its suggested
 * bindings at once (one signed request, confirmed in a dialog), or edits single tools.
 */
export function RepositoryEntryCard({
	entry,
	serverControls,
	bindings = [],
	bindingControls,
}: {
	entry: RepositoryExtensionEntry
	serverControls?: ServerControls
	bindings?: readonly RemoteBindingView[]
	bindingControls?: BindingControls
}) {
	const [acceptOpen, setAcceptOpen] = useState(false)
	const [addOpen, setAddOpen] = useState(false)
	const pending = pendingSuggestedBindings(entry, bindings)
	const toAdd = entry.added ? [] : suggestableTools(entry, bindings)
	const requestsFor = (tools: readonly RepositoryTool[]) =>
		tools.map((tool) => toRequest(entry.serverPubkey, tool.name, tool.suggestedBinding))
	const pendingNames = new Set(pending.map((tool) => tool.name))
	const canBind = Boolean(bindingControls) && entry.added && entry.state === 'listed'

	return (
		<li className="space-y-2 rounded-lg border p-3" data-testid={`repository-entry-${entry.serverPubkey}`}>
			<div className="flex flex-wrap items-center gap-2">
				<ExtensionLogo icon={entry.picture} name={entry.name} size={32} />
				<span className="font-medium">{entry.name}</span>
				{entry.version && <Badge variant="secondary">v{entry.version}</Badge>}
				{entry.sideloaded && (
					<Badge variant="outline" className="border-violet-500 text-violet-700">
						Sideloaded
					</Badge>
				)}
				{entry.paid && (
					<Badge variant="outline" className="border-amber-500 text-amber-700">
						Paid
					</Badge>
				)}
				{entry.state === 'unavailable' && (
					<Badge variant="outline" className="border-red-500 text-red-600" title={entry.problem}>
						Unavailable
					</Badge>
				)}
				{entry.website && (
					<a href={entry.website} target="_blank" rel="noopener noreferrer nofollow" className="text-muted-foreground" aria-label="Website">
						<ExternalLink className="h-3.5 w-3.5" />
					</a>
				)}
				<div className="ml-auto flex items-center gap-1">
					{serverControls && !entry.added && (
						<Button
							size="sm"
							disabled={serverControls.pending}
							onClick={() => (toAdd.length > 0 ? setAddOpen(true) : void serverControls.onAdd(entry.serverPubkey))}
							data-testid={`repository-add-${entry.serverPubkey}`}
						>
							<Plus className="mr-1 h-4 w-4" /> Add
						</Button>
					)}
					{bindingControls?.onBindMany && pending.length > 0 && (
						<Button
							size="sm"
							disabled={bindingControls.pending}
							onClick={() => setAcceptOpen(true)}
							data-testid={`accept-all-${entry.serverPubkey}`}
						>
							<Link2 className="mr-1 h-4 w-4" /> Accept suggested ({pending.length})
						</Button>
					)}
					{serverControls && entry.added && (
						<Button
							variant="ghost"
							size="sm"
							disabled={serverControls.pending || bindings.length > 0}
							title={bindings.length > 0 ? 'Remove its bindings first' : 'Remove'}
							onClick={() => serverControls.onRemove(entry.serverPubkey)}
							aria-label={`Remove ${entry.name} from the marketplace`}
							data-testid={`repository-remove-${entry.serverPubkey}`}
						>
							<Trash2 className="h-4 w-4" />
						</Button>
					)}
				</div>
			</div>

			{entry.about && (
				<p className="line-clamp-2 text-sm text-muted-foreground" title={entry.about}>
					{entry.about}
				</p>
			)}

			{entry.added && entry.state === 'listed' && entry.tools.length > 0 && (
				<ul className="space-y-1 text-xs">
					{entry.tools.map((tool) => {
						const toolBindings = bindings.filter((binding) => binding.toolName === tool.name)
						return (
							<li key={tool.name} className="flex flex-wrap items-center gap-2" title={tool.description}>
								<span className="font-mono">{tool.title ?? tool.name}</span>
								{tool.price && (
									<span className="text-amber-700">
										{tool.price.amount} {tool.price.unit}
									</span>
								)}
								{toolBindings.map((binding) => (
									<BindingRow key={binding.actionName} binding={binding} controls={bindingControls} />
								))}
								{canBind && !tool.price && toolBindings.length === 0 && (
									<>
										{pendingNames.has(tool.name) && (
											<span className="text-muted-foreground" data-testid={`suggested-binding-${tool.name}`}>
												→ <span className="font-mono">{tool.suggestedBinding.capability}</span>
											</span>
										)}
										<BindToolForm
											serverPubkey={entry.serverPubkey}
											serverName={entry.name}
											toolName={tool.name}
											suggestion={tool.suggestedBinding}
											controls={bindingControls!}
										/>
									</>
								)}
							</li>
						)
					})}
				</ul>
			)}

			{bindingControls?.onBindMany && (
				<AcceptBindingsDialog
					open={acceptOpen}
					onOpenChange={setAcceptOpen}
					title={`Accept ${pending.length === 1 ? 'binding' : `${pending.length} bindings`}`}
					serverName={entry.name}
					items={pending.map((tool) => ({ toolName: tool.name, suggestion: tool.suggestedBinding }))}
					confirmLabel="Accept"
					disabled={bindingControls.pending}
					error={bindingControls.bindManyError?.serverPubkey === entry.serverPubkey ? bindingControls.bindManyError.message : undefined}
					onConfirm={() => bindingControls.onBindMany!(requestsFor(pending))}
				/>
			)}
			{serverControls && !entry.added && (
				<AcceptBindingsDialog
					open={addOpen}
					onOpenChange={setAddOpen}
					title={`Add ${entry.name}`}
					serverName={entry.name}
					items={toAdd.map((tool) => ({ toolName: tool.name, suggestion: tool.suggestedBinding }))}
					confirmLabel={`Add & accept (${toAdd.length})`}
					disabled={serverControls.pending}
					error={serverControls.addError?.serverPubkey === entry.serverPubkey ? serverControls.addError.message : undefined}
					onConfirm={async () => (await serverControls.onAdd(entry.serverPubkey, requestsFor(toAdd))) !== false}
					secondary={{ label: 'Add only', onClick: async () => (await serverControls.onAdd(entry.serverPubkey)) !== false }}
				/>
			)}
		</li>
	)
}

const BINDING_STATE_LABELS: Record<RemoteBindingView['state'], { label: string; className: string }> = {
	installed_enabled: { label: 'Bound', className: 'border-green-600 text-green-700' },
	installed_disabled: { label: 'Disabled', className: 'border-zinc-400 text-zinc-600' },
	misconfigured: { label: 'Needs review', className: 'border-red-500 text-red-600' },
	unreachable: { label: 'Unreachable', className: 'border-amber-500 text-amber-700' },
}

/** One bound action of a tool: state, action → capability, and icon controls. The problem shows on hover and when it needs action. */
export function BindingRow({ binding, controls }: { binding: RemoteBindingView; controls?: BindingControls }) {
	const state = BINDING_STATE_LABELS[binding.state]
	return (
		<span
			className="inline-flex flex-wrap items-center gap-1"
			title={`${binding.auth === 'admin' ? 'Admins only' : 'Any signed-in user'} · ${binding.rateLimit.perPubkey} per ${formatWindow(binding.rateLimit.windowSeconds)}${binding.problem ? ` · ${binding.problem}` : ''}`}
			data-testid={`binding-${binding.serverPubkey}-${binding.actionName}`}
		>
			<Badge variant="outline" className={state.className}>
				{state.label}
			</Badge>
			<span className="font-mono">{binding.capability}</span>
			{binding.state === 'misconfigured' && binding.problem && <span className="text-red-600">{binding.problem}</span>}
			{controls && (
				<>
					{binding.state === 'misconfigured' && (
						<Button
							size="sm"
							variant="outline"
							className="h-6 px-2 text-xs"
							disabled={controls.pending}
							onClick={() => controls.onUpdate(binding.serverPubkey, binding.actionName, { approveCurrentDefinition: true })}
						>
							Approve
						</Button>
					)}
					<Button
						size="sm"
						variant="ghost"
						className="h-6 px-1"
						disabled={controls.pending}
						onClick={() => controls.onUpdate(binding.serverPubkey, binding.actionName, { enabled: !binding.enabled })}
						aria-label={binding.enabled ? `Disable ${binding.actionName}` : `Enable ${binding.actionName}`}
						title={binding.enabled ? 'Disable' : 'Enable'}
					>
						{binding.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
					</Button>
					<Button
						size="sm"
						variant="ghost"
						className="h-6 px-1"
						disabled={controls.pending}
						onClick={() => controls.onRemove(binding.serverPubkey, binding.actionName)}
						aria-label={`Remove binding ${binding.actionName}`}
						title="Remove binding"
					>
						<Trash2 className="h-3.5 w-3.5" />
					</Button>
				</>
			)}
		</span>
	)
}

export interface AcceptBindingItem {
	toolName: string
	suggestion: SuggestedBinding
}

/** What accepting will create; also rendered on its own in tests (the dialog renders through a portal). */
export function AcceptBindingsSummary({ serverName, items }: { serverName: string; items: readonly AcceptBindingItem[] }) {
	return (
		<div className="space-y-3 text-sm" data-testid="accept-bindings-summary">
			<ul className="divide-y rounded border">
				{items.map(({ toolName, suggestion }) => (
					<li key={toolName} className="flex flex-wrap items-center gap-2 p-2">
						<span className="font-mono text-xs">{toolName}</span>
						<span>→</span>
						<span className="font-mono">{suggestion.capability}</span>
						<span className="ml-auto text-xs text-muted-foreground">
							{suggestion.auth === 'admin' ? 'Admins only' : 'Any signed-in user'}
						</span>
					</li>
				))}
			</ul>
			<p className="text-xs text-muted-foreground">
				Input goes to <strong>{serverName}</strong>; replies are untrusted. {DEFAULT_RATE_LIMIT.perPubkey} calls per hour per caller.
			</p>
		</div>
	)
}

/**
 * Confirmation listing the bindings that will be created for one extension. Confirming is the admin's data-flow
 * consent and sends one signed request; the server creates everything or nothing. Used for "Accept suggested" and for
 * "Add" (add + accept together, with an "Add only" alternative).
 */
export function AcceptBindingsDialog({
	open,
	onOpenChange,
	title,
	serverName,
	items,
	confirmLabel,
	onConfirm,
	secondary,
	error,
	disabled = false,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	title: string
	serverName: string
	items: readonly AcceptBindingItem[]
	confirmLabel: string
	/** Resolves to `true` on success, which closes the dialog. */
	onConfirm: () => Promise<boolean>
	secondary?: { label: string; onClick: () => Promise<boolean> }
	error?: string
	disabled?: boolean
}) {
	const [busy, setBusy] = useState(false)
	const run = async (action: () => Promise<boolean>) => {
		if (busy || disabled) return
		setBusy(true)
		const ok = await action()
		setBusy(false)
		if (ok) onOpenChange(false)
	}

	return (
		<Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
			<DialogContent className="sm:max-w-lg" data-testid="accept-bindings-dialog">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{serverName}</DialogDescription>
				</DialogHeader>
				{items.length > 0 && <AcceptBindingsSummary serverName={serverName} items={items} />}
				{error && (
					<p role="alert" className="text-sm text-red-600" data-testid="accept-bindings-error">
						{error}
					</p>
				)}
				<DialogFooter>
					<Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					{secondary && (
						<Button
							variant="outline"
							disabled={busy || disabled}
							onClick={() => void run(secondary.onClick)}
							data-testid="accept-bindings-secondary"
						>
							{secondary.label}
						</Button>
					)}
					<Button disabled={busy || disabled} onClick={() => void run(onConfirm)} data-testid="accept-bindings-confirm">
						{busy ? 'Working…' : confirmLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

/** "Edit" for a single tool: opens a compact form prefilled with its suggestion. The server re-checks and pins it. */
export function BindToolForm({
	serverPubkey,
	serverName,
	toolName,
	suggestion,
	controls,
}: {
	serverPubkey: string
	serverName: string
	toolName: string
	suggestion: SuggestedBinding
	controls: BindingControls
}) {
	const [open, setOpen] = useState(false)
	const [capability, setCapability] = useState(suggestion.capability)
	const [actionName, setActionName] = useState(suggestion.actionName)
	const [auth, setAuth] = useState<'user' | 'admin'>(suggestion.auth)
	const [acknowledged, setAcknowledged] = useState(false)
	const [submitting, setSubmitting] = useState(false)
	const error =
		controls.bindError?.serverPubkey === serverPubkey && controls.bindError.toolName === toolName ? controls.bindError.message : undefined
	const capabilityError = capabilityProblem(capability.trim())
	const actionError = actionNameProblem(actionName.trim())
	const suggestionsId = `bind-capabilities-${serverPubkey.slice(0, 8)}-${toolName}`

	if (!open) {
		return (
			<Button
				size="sm"
				variant="ghost"
				className="h-6 px-1"
				onClick={() => setOpen(true)}
				aria-label={`Edit binding for ${toolName}`}
				title="Edit"
				data-testid={`bind-open-${toolName}`}
			>
				<Pencil className="h-3.5 w-3.5" />
			</Button>
		)
	}

	const submit = async (event: FormEvent) => {
		event.preventDefault()
		// The local flag blocks a second submit before the pending state has re-rendered (e.g. a double click).
		if (!acknowledged || capabilityError || actionError || controls.pending || submitting) return
		setSubmitting(true)
		const created = await controls.onBind({
			serverPubkey,
			toolName,
			actionName: actionName.trim(),
			capability: capability.trim(),
			auth,
			rateLimit: DEFAULT_RATE_LIMIT,
			acknowledgedDataFlow: true,
		})
		setSubmitting(false)
		if (created) setOpen(false)
	}

	return (
		<form
			onSubmit={submit}
			className="flex w-full flex-wrap items-center gap-2 rounded border border-dashed p-2"
			data-testid={`bind-form-${toolName}`}
		>
			<Input
				className="h-8 w-48"
				aria-label="Capability"
				placeholder="product.image.describe"
				list={suggestionsId}
				autoCapitalize="none"
				spellCheck={false}
				value={capability}
				aria-invalid={Boolean(capabilityError)}
				onChange={(event) => setCapability(event.target.value.toLowerCase())}
				data-testid={`bind-capability-${toolName}`}
			/>
			<datalist id={suggestionsId}>
				{(controls.capabilitySuggestions ?? []).map((value) => (
					<option key={value} value={value} />
				))}
			</datalist>
			<Input
				className="h-8 w-40"
				aria-label="Action name"
				autoCapitalize="none"
				spellCheck={false}
				value={actionName}
				aria-invalid={Boolean(actionError)}
				onChange={(event) => setActionName(event.target.value.toLowerCase())}
			/>
			<select
				aria-label="Who may call it"
				className="h-8 rounded-md border bg-white px-2 text-xs"
				value={auth}
				onChange={(event) => setAuth(event.target.value === 'user' ? 'user' : 'admin')}
			>
				<option value="admin">Admins</option>
				<option value="user">Users</option>
			</select>
			<label className="flex items-center gap-1" title={`Input goes to ${serverName}; replies are untrusted.`}>
				<input
					type="checkbox"
					checked={acknowledged}
					onChange={(event) => setAcknowledged(event.target.checked)}
					data-testid="bind-consent"
				/>
				Send input to {serverName}
			</label>
			<Button
				type="submit"
				size="sm"
				className="h-8"
				disabled={!acknowledged || controls.pending || submitting || Boolean(capabilityError) || Boolean(actionError)}
				data-testid="bind-submit"
			>
				{submitting ? 'Binding…' : 'Bind'}
			</Button>
			<Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setOpen(false)}>
				Cancel
			</Button>
			{(error || capabilityError || actionError) && (
				<p role="alert" className="w-full text-red-600" data-testid={`bind-error-${toolName}`}>
					{error ?? capabilityError ?? actionError}
				</p>
			)}
		</form>
	)
}

export interface RemoteActionOption {
	extensionId: string
	actionName: string
	label: string
}

export interface RemoteActionTryPanelProps {
	actions: readonly RemoteActionOption[]
	onRun: (option: RemoteActionOption, input: Record<string, unknown>) => void
	pending: boolean
	result?: { text: string; data?: Record<string, unknown> }
	errorMessage?: string
}

/** Admin test bench for bound remote actions; replies are untrusted and rendered as plain text. */
export function RemoteActionTryPanel({ actions, onRun, pending, result, errorMessage }: RemoteActionTryPanelProps) {
	const [selected, setSelected] = useState(0)
	const [input, setInput] = useState('{}')
	const [inputError, setInputError] = useState<string>()
	if (actions.length === 0) return null

	const submit = (event: FormEvent) => {
		event.preventDefault()
		let parsed: unknown
		try {
			parsed = JSON.parse(input)
		} catch {
			parsed = undefined
		}
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
			setInputError('Input must be a JSON object')
			return
		}
		setInputError(undefined)
		onRun(actions[Math.min(selected, actions.length - 1)], parsed as Record<string, unknown>)
	}

	return (
		<Card data-testid="remote-action-panel">
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-lg">
					<Link2 className="h-5 w-5" /> Try a remote action
				</CardTitle>
				<CardDescription>Calls a bound third-party tool through this marketplace, signed with your Nostr key.</CardDescription>
			</CardHeader>
			<CardContent>
				<form onSubmit={submit} className="space-y-3">
					<div className="space-y-1">
						<Label htmlFor="remote-action-select">Action</Label>
						<select
							id="remote-action-select"
							className="h-9 w-full rounded-md border bg-white px-2 text-sm"
							value={selected}
							onChange={(event) => setSelected(Number(event.target.value))}
						>
							{actions.map((option, index) => (
								<option key={`${option.extensionId}/${option.actionName}`} value={index}>
									{option.label}
								</option>
							))}
						</select>
					</div>
					<div className="space-y-1">
						<Label htmlFor="remote-action-input">Input (JSON object)</Label>
						<Textarea
							id="remote-action-input"
							className="font-mono text-xs"
							rows={4}
							value={input}
							onChange={(event) => setInput(event.target.value)}
						/>
					</div>
					<Button type="submit" disabled={pending} data-testid="remote-action-run">
						{pending ? 'Running…' : 'Run'}
					</Button>
				</form>
				{(inputError || errorMessage) && (
					<p role="alert" className="mt-3 text-sm text-red-600">
						{inputError ?? errorMessage}
					</p>
				)}
				{result && (
					<div className="mt-3 space-y-2 rounded-lg border bg-zinc-50 p-3 text-sm" data-testid="remote-action-result">
						<Badge variant="outline" className="border-sky-500 text-sky-700">
							Third-party reply — untrusted
						</Badge>
						{result.text && <p className="whitespace-pre-wrap">{result.text}</p>}
						{result.data && <pre className="overflow-x-auto text-xs">{JSON.stringify(result.data, null, 2)}</pre>}
					</div>
				)}
			</CardContent>
		</Card>
	)
}

/** Add a ContextVM server by pubkey (a sideload if no registry lists it); the server validates the value. */
export function AddServerForm({ controls }: { controls: ServerControls }) {
	const [server, setServer] = useState('')
	const submit = (event: FormEvent) => {
		event.preventDefault()
		if (!server.trim() || controls.pending) return
		controls.onAdd(server.trim())
		setServer('')
	}
	return (
		<form onSubmit={submit} className="space-y-1" data-testid="add-server-form">
			<div className="flex gap-2">
				<Input
					aria-label="Server pubkey"
					data-testid="add-server-input"
					placeholder="Add server: npub1… or hex"
					value={server}
					onChange={(event) => setServer(event.target.value)}
				/>
				<Button type="submit" disabled={controls.pending || !server.trim()} data-testid="add-server-submit">
					<Plus className="mr-1 h-4 w-4" /> Add
				</Button>
			</div>
			{controls.errorMessage && (
				<p role="alert" className="text-sm text-red-600" data-testid="add-server-error">
					{controls.errorMessage}
				</p>
			)}
		</form>
	)
}

export function RepositorySection({
	repository,
	registryEnvExample,
	servers,
	bindings = [],
	bindingControls,
}: {
	repository: RepositorySnapshot | undefined
	registryEnvExample: string
	servers?: ServerControls
	bindings?: readonly RemoteBindingView[]
	bindingControls?: BindingControls
}) {
	if (!repository) {
		return (
			<div className="space-y-2 py-6 text-center text-sm text-muted-foreground">
				<p>No relay configured.</p>
				<pre className="mx-auto w-fit rounded bg-zinc-100 px-3 py-2 text-left text-xs">{registryEnvExample}</pre>
			</div>
		)
	}
	return (
		<div className="space-y-3">
			{servers && <AddServerForm controls={servers} />}
			{repository.curators.length === 0 && (
				<p className="text-xs text-muted-foreground" title={registryEnvExample}>
					No registries configured.
				</p>
			)}
			{repository.problem && (
				<p role="alert" className="text-sm text-red-600">
					{repository.problem}
				</p>
			)}
			{repository.missingRegistries.length > 0 && (
				<p className="text-xs text-amber-700" title={repository.missingRegistries.join('\n')}>
					{repository.missingRegistries.length} registry list(s) not found.
				</p>
			)}
			{bindingControls?.errorMessage && (
				<p role="alert" className="text-sm text-red-600" data-testid="binding-error">
					{bindingControls.errorMessage}
				</p>
			)}
			{repository.entries.length === 0 ? (
				<p className="py-4 text-center text-sm text-muted-foreground">No extensions yet.</p>
			) : (
				<ul className="space-y-2">
					{repository.entries.map((entry) => (
						<RepositoryEntryCard
							key={entry.serverPubkey}
							entry={entry}
							serverControls={servers}
							bindings={bindings.filter((binding) => binding.serverPubkey === entry.serverPubkey)}
							bindingControls={bindingControls}
						/>
					))}
				</ul>
			)}
		</div>
	)
}

export interface ExtensionStoreViewProps {
	catalog: ExtensionCatalog | undefined
	isLoading: boolean
	errorMessage?: string
	onRetry: () => void
	registryEnvExample: string
	servers?: ServerControls
	bindingControls?: BindingControls
	builtins?: BuiltinControls
}

/**
 * The store page body: a repository of third-party extensions from registries the operator trusts (and added by
 * pubkey), plus the built-ins in this release. Enabling built-ins stays in the server environment (ADR-0023 §7).
 */
export function ExtensionStoreView({
	catalog,
	isLoading,
	errorMessage,
	onRetry,
	registryEnvExample,
	servers,
	bindingControls,
	builtins,
}: ExtensionStoreViewProps) {
	return (
		<div className="space-y-4" data-testid="extension-store">
			{isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>}
			{errorMessage && (
				<div className="space-y-2 py-4 text-center">
					<p role="alert" className="text-sm text-red-600">
						{errorMessage}
					</p>
					<Button variant="outline" size="sm" onClick={onRetry}>
						Retry
					</Button>
				</div>
			)}
			{catalog && (
				<Tabs defaultValue="repository" className="w-full">
					<TabsList>
						<TabsTrigger value="repository" data-testid="extension-store-tab-repository">
							Repository ({catalog.repository?.entries.length ?? 0})
						</TabsTrigger>
						<TabsTrigger value="builtin" data-testid="extension-store-tab-builtin">
							Built-in ({catalog.entries.length})
						</TabsTrigger>
					</TabsList>
					<TabsContent value="repository" className="pt-3">
						<RepositorySection
							repository={catalog.repository}
							registryEnvExample={registryEnvExample}
							servers={servers}
							bindings={catalog.bindings}
							bindingControls={bindingControls}
						/>
					</TabsContent>
					<TabsContent value="builtin" className="pt-3">
						{builtins?.errorMessage && (
							<p role="alert" className="mb-2 text-sm text-red-600" data-testid="builtin-error">
								{builtins.errorMessage}
							</p>
						)}
						{catalog.entries.length === 0 ? (
							<p className="py-6 text-center text-sm text-muted-foreground">None.</p>
						) : (
							<ul className="space-y-2">
								{catalog.entries.map((entry) => (
									<ExtensionStoreEntry key={entry.id} entry={entry} controls={builtins} />
								))}
							</ul>
						)}
					</TabsContent>
				</Tabs>
			)}
		</div>
	)
}

function formatWindow(seconds: number): string {
	if (seconds % 3600 === 0) return seconds === 3600 ? 'hour' : `${seconds / 3600} hours`
	if (seconds % 60 === 0) return seconds === 60 ? 'minute' : `${seconds / 60} minutes`
	return `${seconds}s`
}
