import { ImageIcon, Plus, Puzzle, ShieldCheck, Sparkles, Store, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type {
	ExtensionCatalog,
	ExtensionCatalogEntry,
	ExtensionCatalogState,
	ExtensionHostPortName,
	PublicExtensionDescriptor,
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
}: {
	entry: RepositoryExtensionEntry
	onRemove?: (pubkey: string) => void
	removing?: boolean
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
							</li>
						))}
					</ul>
				</div>
			)}

			<p className="text-xs text-muted-foreground">
				{entry.paid
					? 'Paid extensions cannot be installed: paying third-party services is not supported yet.'
					: 'Installing third-party extensions is not available yet. Listings are for review only.'}
			</p>
		</li>
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
}: {
	repository: RepositorySnapshot | undefined
	registryEnvExample: string
	sideload?: SideloadControls
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
						<RepositoryEntryCard key={entry.serverPubkey} entry={entry} onRemove={sideload?.onRemove} removing={sideload?.pending} />
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
							<RepositorySection repository={catalog.repository} registryEnvExample={registryEnvExample} sideload={sideload} />
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
