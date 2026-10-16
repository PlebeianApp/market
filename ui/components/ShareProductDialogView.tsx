import type { ChangeEvent } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '../primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../primitives/dialog'
import { Textarea } from '../primitives/textarea'

export interface ShareProductDialogViewProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	/** Signed-in viewers can post the share text as a note. */
	canPost: boolean
	shareText: string
	onShareTextChange: (text: string) => void
	isCopied: boolean
	isPosting: boolean
	onCopyUrl: () => void
	onPost: () => void
}

export function ShareProductDialogView({
	open,
	onOpenChange,
	canPost,
	shareText,
	onShareTextChange,
	isCopied,
	isPosting,
	onCopyUrl,
	onPost,
}: ShareProductDialogViewProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="bg-white max-w-[calc(100%-2rem)] sm:max-w-[40em] max-h-[90vh] overflow-x-hidden overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Share Product</DialogTitle>
					<DialogDescription id="share-dialog-description">Share this product with others or post it to your Nostr feed.</DialogDescription>
				</DialogHeader>

				<div className="space-y-6 py-4 overflow-x-hidden">
					{canPost && (
						<div className="space-y-2">
							<label htmlFor="share-text" className="font-medium text-gray-700 text-sm">
								Content to post to Nostr
							</label>
							<Textarea
								id="share-text"
								aria-describedby="share-dialog-description"
								value={shareText}
								onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onShareTextChange(event.target.value)}
								rows={8}
								className="w-full overflow-wrap-anywhere break-words whitespace-pre-wrap resize-none"
								placeholder="Write something about this product..."
							/>
						</div>
					)}

					<div className="flex flex-wrap gap-2">
						<Button variant="outline" onClick={onCopyUrl} className="shrink-0">
							{isCopied ? <Check className="mr-2 w-4 h-4" /> : <Copy className="mr-2 w-4 h-4" />}
							{isCopied ? 'Copied!' : 'Copy URL'}
						</Button>

						{canPost && (
							<Button onClick={onPost} disabled={isPosting || !shareText.trim()} className="flex flex-1 justify-center items-center gap-2">
								<span className="w-4 h-4 i-send-message" />
								{isPosting ? 'Posting...' : 'Post to Nostr'}
							</Button>
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	)
}
