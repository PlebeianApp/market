import { ImageIcon, Puzzle, Sparkles } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { PublicExtensionDescriptor } from '@sdk/core/extensions'
import { Badge } from '../primitives/badge'
import { Button } from '../primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../primitives/card'
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

function formatWindow(seconds: number): string {
	if (seconds % 3600 === 0) return seconds === 3600 ? 'hour' : `${seconds / 3600} hours`
	if (seconds % 60 === 0) return seconds === 60 ? 'minute' : `${seconds / 60} minutes`
	return `${seconds}s`
}
