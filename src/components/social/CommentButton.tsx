import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@ui/primitives/dialog'
import { Textarea } from '@ui/primitives/textarea'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { useStore } from '@tanstack/react-store'
import { useState, type MouseEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { authStore } from '@/lib/stores/auth'
import type { ButtonProps } from '@ui/components/ButtonProps'
import { CommentButtonView } from '@ui/components/SocialButtons'
import { Button } from '@ui/primitives/button'

interface CommentButtonProps extends ButtonProps {
	event: NDKEvent
	icon?: ReactNode
	tooltip?: string
}

export function CommentButton({ event, onClick, ...props }: CommentButtonProps) {
	const [dialogOpen, setDialogOpen] = useState(false)
	const [isPosting, setIsPosting] = useState(false)
	const { isAuthenticated } = useStore(authStore)

	const handlePress = (e: MouseEvent<HTMLButtonElement>) => {
		if (onClick) {
			onClick(e)
		} else if (isAuthenticated) {
			setDialogOpen(true)
		} else {
			toast.error('Please log in to comment')
		}
	}

	const handlePostComment = async () => {
		if (!isAuthenticated) {
			toast.error('You must be logged in to comment.')
			return
		}

		// TODO
	}

	return (
		<>
			<CommentButtonView {...props} onPress={handlePress} disabled={props.disabled || !event.ndk} />

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
