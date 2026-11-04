import { ImageIcon, Puzzle, ShieldCheck, Sparkles, Store } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { ExtensionCatalogEntry, ExtensionCatalogState, ExtensionHostPortName, PublicExtensionDescriptor } from '@sdk/core/extensions'
import { Badge } from '../primitives/badge'
import { Button } from '../primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../primitives/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../primitives/dialog'
import { Input } from '../primitives/input'
import { Label } from '../primitives/label'
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

export interface ExtensionStoreDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	entries: readonly ExtensionCatalogEntry[] | undefined
	isLoading: boolean
	errorMessage?: string
	onRetry: () => void
}

/** Read-only store (ADR-0023 §7): installs are environment-managed until a server-side settings store exists. */
export function ExtensionStoreDialog({ open, onOpenChange, entries, isLoading, errorMessage, onRetry }: ExtensionStoreDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl" data-testid="extension-store-dialog">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Store className="h-5 w-5" /> Extension store
					</DialogTitle>
					<DialogDescription>
						Extensions available on this marketplace. Enabling is managed in the server environment for now; installing from here comes with
						the settings store.
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
				{entries && entries.length === 0 && !isLoading && (
					<p className="py-6 text-center text-sm text-muted-foreground">No extensions are available in this release.</p>
				)}
				{entries && entries.length > 0 && (
					<ul className="space-y-3">
						{entries.map((entry) => (
							<ExtensionStoreEntry key={entry.id} entry={entry} />
						))}
					</ul>
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
