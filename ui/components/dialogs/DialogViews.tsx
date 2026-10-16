import { useState, type ReactNode } from 'react'
import { AlertTriangle, Check, Copy } from 'lucide-react'
import { Button } from '../../primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../primitives/dialog'
import { QRCode } from '../../primitives/qr-code'
import { Textarea } from '../../primitives/textarea'

export interface NSFWConfirmationDialogViewProps {
	open: boolean
	onConfirm: () => void
	onCancel: () => void
}

export function NSFWConfirmationDialogView({ open, onConfirm, onCancel }: NSFWConfirmationDialogViewProps) {
	return (
		<Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<AlertTriangle className="w-5 h-5 text-amber-500" />
						Adult Content Warning
					</DialogTitle>
					<DialogDescription>You are about to enable viewing of adult and sensitive content.</DialogDescription>
				</DialogHeader>

				<div className="py-4 space-y-3 text-sm text-muted-foreground">
					<p>This marketplace may contain products that include:</p>
					<ul className="list-disc pl-5 space-y-1">
						<li>Adult/NSFW content</li>
						<li>Alcohol and tobacco products</li>
						<li>Weapons and related items</li>
						<li>Other age-restricted content</li>
					</ul>
					<p className="font-medium text-foreground">
						By enabling this setting, you confirm that you are of legal age in your jurisdiction to view such content.
					</p>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={onCancel}>
						Cancel
					</Button>
					<Button onClick={onConfirm} className="bg-amber-600 hover:bg-amber-700">
						I understand, show adult content
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

export interface ShareEventDialogViewProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	title?: string
	description?: string
	canPost: boolean
	shareText: string
	onShareTextChange: (text: string) => void
	isCopied: boolean
	isPosting: boolean
	onCopyUrl: () => void
	onPost: () => void
}

export function ShareEventDialogView({
	open,
	onOpenChange,
	title,
	description,
	canPost,
	shareText,
	onShareTextChange,
	isCopied,
	isPosting,
	onCopyUrl,
	onPost,
}: ShareEventDialogViewProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[425px] max-h-[90vh] overflow-x-hidden overflow-y-auto bg-white">
				<DialogHeader>
					<DialogTitle>Share Event</DialogTitle>
					<DialogDescription id="share-dialog-description">Share this event with others or post it to your Nostr feed.</DialogDescription>
				</DialogHeader>

				<div className="space-y-6 py-4 overflow-x-hidden">
					{title && description && (
						<div className="space-y-2">
							<h3 className="font-semibold">{title}</h3>
							<p className="text-sm text-muted-foreground">{description}</p>
						</div>
					)}

					{canPost && (
						<div className="space-y-2">
							<label htmlFor="share-text" className="text-sm font-medium text-gray-700">
								Content to post to Nostr
							</label>
							<Textarea
								id="share-text"
								aria-describedby="share-dialog-description"
								value={shareText}
								onChange={(e) => onShareTextChange(e.target.value)}
								rows={8}
								className="resize-none break-words whitespace-pre-wrap w-full overflow-wrap-anywhere"
								placeholder="Write something about this event..."
							/>
						</div>
					)}

					<div className="flex gap-2 flex-wrap">
						<Button variant="outline" onClick={onCopyUrl} className="shrink-0">
							{isCopied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
							{isCopied ? 'Copied!' : 'Copy URL'}
						</Button>

						{canPost && (
							<Button
								onClick={onPost}
								disabled={isPosting || !shareText.trim()}
								className="flex-1 flex items-center justify-center gap-2 bg-secondary hover:bg-secondary/90 text-white"
							>
								<span className="i-send-message w-4 h-4" />
								{isPosting ? 'Posting...' : 'Post to Nostr'}
							</Button>
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	)
}

export interface ShareProfileDialogViewProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	npub: string
	profileName?: string
	/** Called after a copy attempt so the host can notify. */
	onCopyResult?: (copied: boolean) => void
}

export function ShareProfileDialogView({ open, onOpenChange, npub, profileName, onCopyResult }: ShareProfileDialogViewProps) {
	const [isCopied, setIsCopied] = useState(false)

	const handleCopyNpub = async () => {
		try {
			await navigator.clipboard.writeText(npub)
			setIsCopied(true)
			onCopyResult?.(true)
			setTimeout(() => setIsCopied(false), 2000)
		} catch (error) {
			console.error('Failed to copy npub:', error)
			onCopyResult?.(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="bg-white max-w-[calc(100%-2rem)] sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Share Profile</DialogTitle>
					<DialogDescription>
						{profileName ? `Share ${profileName}'s profile` : 'Share this profile'} with others using the QR code or copy the npub.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col items-center gap-6 py-4">
					<QRCode value={npub} size={200} showBorder={false} />

					<div className="space-y-2 w-full">
						<p className="text-gray-500 text-xs text-center">npub</p>
						<div className="flex items-center gap-2">
							<code className="flex-1 bg-gray-100 p-2 rounded text-xs break-all select-all">{npub}</code>
							<Button variant="outline" size="icon" onClick={handleCopyNpub} className="shrink-0">
								{isCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
							</Button>
						</div>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	)
}

export interface V4VSetupDialogViewProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	/** The V4V editor, supplied by the host. */
	children: ReactNode
}

export function V4VSetupDialogView({ open, onOpenChange, children }: V4VSetupDialogViewProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Set up Value for Value (V4V)</DialogTitle>
					<DialogDescription>
						Configure how much of your sales will be shared with the community. This helps support the platform and other contributors.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-6 py-4">{children}</div>
			</DialogContent>
		</Dialog>
	)
}
