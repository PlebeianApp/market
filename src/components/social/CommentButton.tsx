import { Button, type ButtonProps, type ButtonVariant } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { useStore } from '@tanstack/react-store'
import { MessageSquare } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { authStore } from '@/lib/stores/auth'
import { ndkActions } from '@/lib/stores/ndk'

interface CommentButtonProps extends ButtonProps {
	event: NDKEvent
	variant?: ButtonVariant
}

export function CommentButton({ event, className, onClick, onPointerDown, variant, ...props }: CommentButtonProps) {
	const [dialogOpen, setDialogOpen] = useState(false)
	const [isPosting, setIsPosting] = useState(false)
	const { isAuthenticated } = useStore(authStore)

	const handleButtonInteraction = (e: React.MouseEvent<HTMLButtonElement>) => {
		e.preventDefault()
		e.stopPropagation()

		if (onClick) {
			onClick?.(e)
		} else {
			if (isAuthenticated) {
				setDialogOpen(true)
			} else {
				toast.error('Please log in to comment')
			}
		}
	}

	const handleButtonPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
		e.stopPropagation()
		onPointerDown?.(e)
	}

	const handlePostComment = async () => {
		if (!isAuthenticated) {
			toast.error('You must be logged in to comment.')
			return
		}

		// TODO
	}

	// Default values for props
	const icon = props.icon ?? <MessageSquare className="w-6 h-6" />
	const tooltip = props.tooltip ?? 'Comment'

	return (
		<>
			<Button
				variant={variant ?? 'outline'}
				size="icon"
				className={'border-foreground border-2 bg-transparent hover:bg-foreground hover:text-background ' + className}
				type="button"
				{...props}
				tooltip={tooltip}
				icon={icon}
				data-testid="comment-button"
				onClick={(e) => {
					handleButtonInteraction(e)
				}}
				onPointerDown={handleButtonPointerDown}
				disabled={props.disabled || !event.ndk}
			/>

			{/* Comment Dialog */}
			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent className="sm:max-w-[425px]">
					<DialogHeader>
						<DialogTitle>Comment on this post</DialogTitle>
						<DialogDescription>Share your thoughts with the community.</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						<Textarea placeholder="Write your comment here..." className="min-h-[120px] resize-none" rows={6} />
						<DialogFooter>
							<Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
								Cancel
							</Button>
							<Button type="submit" onClick={handlePostComment} disabled={isPosting}>
								{isPosting ? 'Posting...' : 'Post Comment'}
							</Button>
						</DialogFooter>
					</div>
				</DialogContent>
			</Dialog>
		</>
	)
}
