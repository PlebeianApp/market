import { ImageIcon, Link2, Plus, Puzzle, ShieldCheck, Sparkles, Store, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
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
} from '@sdk/core/extensions'
import { Badge } from '../primitives/badge'
import { Button } from '../primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../primitives/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../primitives/dialog'
import { Input } from '../primitives/input'
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

export function ExtensionsEmptyState({ envExample }: { envExample: string }) {
	return (
		<Card>
			<CardContent className="space-y-3 py-8 text-center">
				<Puzzle className="mx-auto h-10 w-10 text-muted-foreground" />
				<p className="font-medium">No extensions are enabled on this instance.</p>
				<p className="text-sm text-muted-foreground">
					Extensions are enabled by the operator in the server environment, then the server is restarted:
				</p>
				<pre className="mx-auto w-fit rounded bg-zinc-100 px-3 py-2 text-left text-xs">{envExample}</pre>
			</CardContent>
		</Card>
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

export function ExtensionStoreButton({ onClick }: { onClick: () => void }) {
	return (
		<Button variant="outline" onClick={onClick} data-testid="extension-store-button">
			<Store className="mr-2 h-4 w-4" />
			Extension store
		</Button>
	)
}

const STATE_LABELS: Record<ExtensionCatalogState, { label: string; className: string }> = {
	installed_enabled: { label: 'Enabled', className: 'border-green-600 text-green-700' },
	available: { label: 'Available', className: 'border-zinc-400 text-zinc-600' },
	misconfigured: { label: 'Needs attention', className: 'border-red-500 text-red-600' },
}

const PORT_LABELS: Record<ExtensionHostPortName, string> = {
	'relays:read': 'Read events from this marketplace’s relays',
	'relays:publish': 'Publish already-signed events to this marketplace’s relays',
	http: 'Make HTTP requests to the listed origins',
	storage: 'Keep its own key/value data on the server',
}

export function ExtensionStoreEntry({ entry }: { entry: ExtensionCatalogEntry }) {
	const state = STATE_LABELS[entry.state]
	return (
		<li className="space-y-3 rounded-lg border p-4" data-testid={`extension-store-entry-${entry.id}`}>
			<div className="flex items-start gap-3">
				<ExtensionLogo icon={entry.icon} name={entry.displayName} size={40} />
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2 font-medium">
						{entry.displayName}
						<Badge variant="secondary">v{entry.version}</Badge>
						<Badge variant="outline" className={state.className} data-testid={`extension-store-state-${entry.id}`}>
							{state.label}
						</Badge>
						<Badge variant="outline">Built-in</Badge>
					</div>
					{entry.description && <p className="text-sm text-muted-foreground">{entry.description}</p>}
				</div>
			</div>

			{entry.problem && (
				<p role="alert" className="text-sm text-red-600">
					{entry.problem}
				</p>
			)}

			<div className="grid gap-3 text-sm md:grid-cols-2">
				<div>
					<div className="mb-1 font-medium">Capabilities</div>
					<div className="flex flex-wrap gap-1">
						{entry.capabilities.map((capability) => (
							<Badge key={capability} variant="outline" className="font-mono">
								{capability}
							</Badge>
						))}
					</div>
				</div>
				<div>
					<div className="mb-1 flex items-center gap-1 font-medium">
						<ShieldCheck className="h-4 w-4" /> Permissions
					</div>
					{entry.hostPorts.length === 0 ? (
						<p className="text-muted-foreground">No relay, network, or storage access.</p>
					) : (
						<ul className="list-disc pl-5 text-muted-foreground">
							{entry.hostPorts.map((port) => (
								<li key={port}>
									{PORT_LABELS[port]}
									{port === 'http' && entry.egress.length > 0 && <span className="block font-mono text-xs">{entry.egress.join(', ')}</span>}
								</li>
							))}
						</ul>
					)}
				</div>
			</div>

			{entry.state !== 'installed_enabled' && (
				<div className="text-sm">
					<div className="mb-1 font-medium">To enable</div>
					<p className="mb-1 text-muted-foreground">Set this in the server environment and restart the server:</p>
					<pre className="overflow-x-auto rounded bg-zinc-100 px-3 py-2 text-xs">
						{`${entry.envPrefix}ENABLED=true${entry.hasPrivateConfig ? `\n${entry.envPrefix}<SETTING>=…   # private settings, see the extension docs` : ''}`}
					</pre>
				</div>
			)}
		</li>
	)
}

const shortKey = (pubkey: string) => `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`

export interface SideloadControls {
	onAdd: (server: string) => void
	onRemove: (pubkey: string) => void
	pending: boolean
	errorMessage?: string
}

/**
 * Third-party extension from a registry or a sideload. Browse-only: binding remote tools is not implemented yet,
 * and sideloading only lists a server for review; it grants the server nothing.
 */
export function RepositoryEntryCard({
	entry,
	onRemove,
	removing,
	bindings = [],
	bindingControls,
}: {
	entry: RepositoryExtensionEntry
	onRemove?: (pubkey: string) => void
	removing?: boolean
	bindings?: readonly RemoteBindingView[]
	bindingControls?: BindingControls
}) {
	return (
		<li className="space-y-3 rounded-lg border p-4" data-testid={`repository-entry-${entry.serverPubkey}`}>
			<div className="flex items-start gap-3">
				<ExtensionLogo icon={entry.picture} name={entry.name} size={40} />
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2 font-medium">
						{entry.name}
						{entry.version && <Badge variant="secondary">v{entry.version}</Badge>}
						<Badge variant="outline" className="border-sky-500 text-sky-700">
							Third-party
						</Badge>
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
							<Badge variant="outline" className="border-red-500 text-red-600">
								Unavailable
							</Badge>
						)}
					</div>
					{entry.about && <p className="text-sm text-muted-foreground">{entry.about}</p>}
					<p className="mt-1 text-xs text-muted-foreground">
						Server{' '}
						<span className="font-mono" title={entry.serverPubkey}>
							{shortKey(entry.serverPubkey)}
						</span>
						{entry.listedBy.length > 0 && (
							<>
								{' '}
								· listed by{' '}
								{entry.listedBy.map((curator) => (
									<span key={curator} className="font-mono" title={curator}>
										{shortKey(curator)}{' '}
									</span>
								))}
							</>
						)}
						{entry.sideloaded && entry.listedBy.length === 0 && ' · added by an admin of this marketplace'}
						{entry.website && (
							<>
								{' '}
								·{' '}
								<a href={entry.website} target="_blank" rel="noopener noreferrer nofollow" className="underline">
									website
								</a>
							</>
						)}
					</p>
				</div>
				{entry.sideloaded && onRemove && (
					<Button
						variant="ghost"
						size="sm"
						disabled={removing}
						onClick={() => onRemove(entry.serverPubkey)}
						aria-label={`Remove ${entry.name}`}
						data-testid={`repository-remove-${entry.serverPubkey}`}
					>
						<Trash2 className="h-4 w-4" />
					</Button>
				)}
			</div>

			{entry.problem && (
				<p role="alert" className="text-sm text-red-600">
					{entry.problem}
				</p>
			)}

			{entry.tools.length > 0 && (
				<div className="text-sm">
					<div className="mb-1 font-medium">Tools</div>
					<ul className="space-y-1">
						{entry.tools.map((tool) => (
							<li key={tool.name} className="text-muted-foreground">
								<span className="font-mono text-foreground">{tool.title ?? tool.name}</span>
								{tool.price && (
									<span className="ml-2 text-xs text-amber-700">
										{tool.price.amount} {tool.price.unit}
									</span>
								)}
								{tool.description && <span className="block">{tool.description}</span>}
								{tool.inputFields.length > 0 && <span className="block text-xs">Inputs: {tool.inputFields.join(', ')}</span>}
								{bindings
									.filter((binding) => binding.toolName === tool.name)
									.map((binding) => (
										<BindingRow key={binding.actionName} binding={binding} controls={bindingControls} />
									))}
								{bindingControls && entry.state === 'listed' && !tool.price && (
									<BindToolForm serverPubkey={entry.serverPubkey} serverName={entry.name} toolName={tool.name} controls={bindingControls} />
								)}
							</li>
						))}
					</ul>
				</div>
			)}

			<p className="text-xs text-muted-foreground">
				{entry.paid
					? 'Paid tools cannot be bound: paying third-party services is not supported yet.'
					: 'Bind a tool to make it callable by this marketplace. User input for a bound tool is sent to this third-party server.'}
			</p>
		</li>
	)
}

export interface BindingControls {
	onBind: (request: RemoteBindingRequest) => void
	onUpdate: (serverPubkey: string, actionName: string, change: { enabled?: boolean; approveCurrentDefinition?: true }) => void
	onRemove: (serverPubkey: string, actionName: string) => void
	pending: boolean
	errorMessage?: string
}

const BINDING_STATE_LABELS: Record<RemoteBindingView['state'], { label: string; className: string }> = {
	installed_enabled: { label: 'Bound', className: 'border-green-600 text-green-700' },
	installed_disabled: { label: 'Disabled', className: 'border-zinc-400 text-zinc-600' },
	misconfigured: { label: 'Needs review', className: 'border-red-500 text-red-600' },
	unreachable: { label: 'Unreachable', className: 'border-amber-500 text-amber-700' },
}

const toActionName = (toolName: string) =>
	toolName
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/^[^a-z]+/, '')
		.slice(0, 64) || 'run'

/** One bound action of a tool, with its state and admin controls. */
export function BindingRow({ binding, controls }: { binding: RemoteBindingView; controls?: BindingControls }) {
	const state = BINDING_STATE_LABELS[binding.state]
	return (
		<div
			className="mt-2 space-y-1 rounded border bg-zinc-50 p-2 text-xs"
			data-testid={`binding-${binding.serverPubkey}-${binding.actionName}`}
		>
			<div className="flex flex-wrap items-center gap-2 text-foreground">
				<Badge variant="outline" className={state.className}>
					{state.label}
				</Badge>
				<span className="font-mono">{binding.actionName}</span>
				<span>→</span>
				<span className="font-mono">{binding.capability}</span>
				<span className="text-muted-foreground">
					{binding.auth === 'admin' ? 'admins only' : 'any signed-in user'} · {binding.rateLimit.perPubkey} per{' '}
					{formatWindow(binding.rateLimit.windowSeconds)}
				</span>
			</div>
			{binding.problem && <p className="text-red-600">{binding.problem}</p>}
			{controls && (
				<div className="flex flex-wrap gap-2">
					{binding.state === 'misconfigured' && (
						<Button
							size="sm"
							variant="outline"
							disabled={controls.pending}
							onClick={() => controls.onUpdate(binding.serverPubkey, binding.actionName, { approveCurrentDefinition: true })}
						>
							Approve new definition
						</Button>
					)}
					<Button
						size="sm"
						variant="outline"
						disabled={controls.pending}
						onClick={() => controls.onUpdate(binding.serverPubkey, binding.actionName, { enabled: !binding.enabled })}
					>
						{binding.enabled ? 'Disable' : 'Enable'}
					</Button>
					<Button
						size="sm"
						variant="ghost"
						disabled={controls.pending}
						onClick={() => controls.onRemove(binding.serverPubkey, binding.actionName)}
						aria-label={`Remove binding ${binding.actionName}`}
					>
						<Trash2 className="h-4 w-4" />
					</Button>
				</div>
			)}
		</div>
	)
}

/** Inline bind form; the server re-checks everything and pins the tool definition it currently sees. */
export function BindToolForm({
	serverPubkey,
	serverName,
	toolName,
	controls,
}: {
	serverPubkey: string
	serverName: string
	toolName: string
	controls: BindingControls
}) {
	const [open, setOpen] = useState(false)
	const [capability, setCapability] = useState('')
	const [actionName, setActionName] = useState(toActionName(toolName))
	const [auth, setAuth] = useState<'user' | 'admin'>('admin')
	const [acknowledged, setAcknowledged] = useState(false)

	if (!open) {
		return (
			<Button size="sm" variant="outline" className="mt-2" onClick={() => setOpen(true)} data-testid={`bind-open-${toolName}`}>
				<Link2 className="mr-1 h-4 w-4" /> Bind…
			</Button>
		)
	}

	const submit = (event: FormEvent) => {
		event.preventDefault()
		if (!acknowledged || controls.pending) return
		controls.onBind({
			serverPubkey,
			toolName,
			actionName: actionName.trim(),
			capability: capability.trim(),
			auth,
			rateLimit: { perPubkey: 30, windowSeconds: 3600 },
			acknowledgedDataFlow: true,
		})
	}

	return (
		<form
			onSubmit={submit}
			className="mt-2 space-y-2 rounded border border-dashed p-2 text-foreground"
			data-testid={`bind-form-${toolName}`}
		>
			<div className="grid gap-2 md:grid-cols-2">
				<div className="space-y-1">
					<Label htmlFor={`bind-capability-${toolName}`}>Capability</Label>
					<Input
						id={`bind-capability-${toolName}`}
						placeholder="e.g. shipping.quote"
						value={capability}
						onChange={(event) => setCapability(event.target.value)}
						required
					/>
				</div>
				<div className="space-y-1">
					<Label htmlFor={`bind-action-${toolName}`}>Action name</Label>
					<Input id={`bind-action-${toolName}`} value={actionName} onChange={(event) => setActionName(event.target.value)} required />
				</div>
			</div>
			<div className="space-y-1">
				<Label htmlFor={`bind-auth-${toolName}`}>Who may call it</Label>
				<select
					id={`bind-auth-${toolName}`}
					className="h-9 w-full rounded-md border bg-white px-2 text-sm"
					value={auth}
					onChange={(event) => setAuth(event.target.value === 'user' ? 'user' : 'admin')}
				>
					<option value="admin">Admins only</option>
					<option value="user">Any signed-in user</option>
				</select>
				<p className="text-xs text-muted-foreground">30 calls per hour per caller.</p>
			</div>
			<label className="flex items-start gap-2 text-xs">
				<input
					type="checkbox"
					checked={acknowledged}
					onChange={(event) => setAcknowledged(event.target.checked)}
					data-testid="bind-consent"
				/>
				<span>
					I understand that input sent to this action goes to the third-party server <strong>{serverName}</strong>, and that its replies are
					shown as untrusted text.
				</span>
			</label>
			<div className="flex gap-2">
				<Button type="submit" size="sm" disabled={!acknowledged || controls.pending || !capability.trim()} data-testid="bind-submit">
					{controls.pending ? 'Binding…' : 'Bind tool'}
				</Button>
				<Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
					Cancel
				</Button>
			</div>
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

/** Sideload a ContextVM server by pubkey; the server validates the value, so any text is accepted here. */
export function SideloadForm({ controls }: { controls: SideloadControls }) {
	const [server, setServer] = useState('')
	const submit = (event: FormEvent) => {
		event.preventDefault()
		if (!server.trim() || controls.pending) return
		controls.onAdd(server.trim())
		setServer('')
	}
	return (
		<form onSubmit={submit} className="space-y-1 rounded-lg border border-dashed p-3" data-testid="sideload-form">
			<Label htmlFor="sideload-server">Add a ContextVM server</Label>
			<div className="flex gap-2">
				<Input
					id="sideload-server"
					data-testid="sideload-server-input"
					placeholder="npub1… or 64-character hex pubkey"
					value={server}
					onChange={(event) => setServer(event.target.value)}
				/>
				<Button type="submit" disabled={controls.pending || !server.trim()} data-testid="sideload-submit">
					<Plus className="mr-1 h-4 w-4" />
					{controls.pending ? 'Adding…' : 'Add'}
				</Button>
			</div>
			<p className="text-xs text-muted-foreground">
				The server is shown from its own signed announcement, labelled sideloaded. Adding it does not grant it any access.
			</p>
			{controls.errorMessage && (
				<p role="alert" className="text-sm text-red-600" data-testid="sideload-error">
					{controls.errorMessage}
				</p>
			)}
		</form>
	)
}

export function RepositorySection({
	repository,
	registryEnvExample,
	sideload,
	bindings = [],
	bindingControls,
}: {
	repository: RepositorySnapshot | undefined
	registryEnvExample: string
	sideload?: SideloadControls
	bindings?: readonly RemoteBindingView[]
	bindingControls?: BindingControls
}) {
	if (!repository) {
		return (
			<div className="space-y-2 py-6 text-center text-sm">
				<p className="font-medium">No relay is configured to read extensions from.</p>
				<p className="text-muted-foreground">
					Set the app relay or the registry relays in the server environment, then restart the server:
				</p>
				<pre className="mx-auto w-fit rounded bg-zinc-100 px-3 py-2 text-left text-xs">{registryEnvExample}</pre>
			</div>
		)
	}
	return (
		<div className="space-y-3">
			{sideload && <SideloadForm controls={sideload} />}
			{repository.curators.length === 0 ? (
				<div className="text-xs text-muted-foreground">
					<p>No registries are configured. To list a registry's extensions, add its curator key and restart the server:</p>
					<pre className="mt-1 w-fit rounded bg-zinc-100 px-3 py-2 text-left">{registryEnvExample}</pre>
				</div>
			) : (
				<p className="text-xs text-muted-foreground">
					Reading {repository.curators.length} {repository.curators.length === 1 ? 'registry' : 'registries'} from{' '}
					<span className="font-mono">{repository.relays.join(', ')}</span>.
				</p>
			)}
			{bindingControls?.errorMessage && (
				<p role="alert" className="text-sm text-red-600" data-testid="binding-error">
					{bindingControls.errorMessage}
				</p>
			)}
			{repository.problem && (
				<p role="alert" className="text-sm text-red-600">
					{repository.problem}
				</p>
			)}
			{repository.missingRegistries.length > 0 && (
				<p className="text-sm text-amber-700">
					No registry list found for{' '}
					{repository.missingRegistries.map((curator) => (
						<span key={curator} className="font-mono" title={curator}>
							{shortKey(curator)}{' '}
						</span>
					))}
				</p>
			)}
			{repository.entries.length === 0 ? (
				<p className="py-4 text-center text-sm text-muted-foreground">No extensions are listed yet.</p>
			) : (
				<ul className="space-y-3">
					{repository.entries.map((entry) => (
						<RepositoryEntryCard
							key={entry.serverPubkey}
							entry={entry}
							onRemove={sideload?.onRemove}
							removing={sideload?.pending}
							bindings={bindings.filter((binding) => binding.serverPubkey === entry.serverPubkey)}
							bindingControls={bindingControls}
						/>
					))}
				</ul>
			)}
		</div>
	)
}

export interface ExtensionStoreDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	catalog: ExtensionCatalog | undefined
	isLoading: boolean
	errorMessage?: string
	onRetry: () => void
	registryEnvExample: string
	sideload?: SideloadControls
	bindingControls?: BindingControls
}

/**
 * The store: a repository of third-party extensions from registries the operator trusts, plus the built-ins in
 * this release. Read-only (ADR-0023 §7): enabling stays in the server environment, remote installs come later.
 */
export function ExtensionStoreDialog({
	open,
	onOpenChange,
	catalog,
	isLoading,
	errorMessage,
	onRetry,
	registryEnvExample,
	sideload,
	bindingControls,
}: ExtensionStoreDialogProps) {
	const repositoryCount = catalog?.repository?.entries.length ?? 0
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl" data-testid="extension-store-dialog">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Store className="h-5 w-5" /> Extension store
					</DialogTitle>
					<DialogDescription>
						Browse extensions from registries this marketplace trusts, and the ones built into this release.
					</DialogDescription>
				</DialogHeader>

				{isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Loading extensions… you may be asked to sign.</p>}
				{errorMessage && (
					<div className="space-y-2 py-4 text-center">
						<p role="alert" className="text-sm text-red-600">
							{errorMessage}
						</p>
						<Button variant="outline" size="sm" onClick={onRetry}>
							Try again
						</Button>
					</div>
				)}
				{catalog && (
					<Tabs defaultValue="repository" className="w-full">
						<TabsList>
							<TabsTrigger value="repository" data-testid="extension-store-tab-repository">
								Repository ({repositoryCount})
							</TabsTrigger>
							<TabsTrigger value="builtin" data-testid="extension-store-tab-builtin">
								Built-in ({catalog.entries.length})
							</TabsTrigger>
						</TabsList>
						<TabsContent value="repository" className="pt-3">
							<RepositorySection
								repository={catalog.repository}
								registryEnvExample={registryEnvExample}
								sideload={sideload}
								bindings={catalog.bindings}
								bindingControls={bindingControls}
							/>
						</TabsContent>
						<TabsContent value="builtin" className="pt-3">
							{catalog.entries.length === 0 ? (
								<p className="py-6 text-center text-sm text-muted-foreground">No extensions are built into this release.</p>
							) : (
								<ul className="space-y-3">
									{catalog.entries.map((entry) => (
										<ExtensionStoreEntry key={entry.id} entry={entry} />
									))}
								</ul>
							)}
						</TabsContent>
					</Tabs>
				)}
			</DialogContent>
		</Dialog>
	)
}

function formatWindow(seconds: number): string {
	if (seconds % 3600 === 0) return seconds === 3600 ? 'hour' : `${seconds / 3600} hours`
	if (seconds % 60 === 0) return seconds === 60 ? 'minute' : `${seconds / 60} minutes`
	return `${seconds}s`
}
