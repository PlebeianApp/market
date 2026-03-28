import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { useStore } from '@tanstack/react-store'
import { MessageSquare } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { authStore } from '@/lib/stores/auth'
import { ndkActions } from '@/lib/stores/ndk'

interface CommentButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	event: NDKEvent
}

export function CommentButton({ event, className, onClick, onPointerDown, ...props }: CommentButtonProps) {
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

	return (
		<>
			<Button
				variant="outline"
				size="icon"
				className={'border-light-gray border-2 bg-transparent text-light-gray hover:text-black ' + className}
				type="button"
				{...props}
				tooltip="Comment"
				onClick={(e) => {
					handleButtonInteraction(e)
				}}
				onPointerDown={handleButtonPointerDown}
				disabled={!event.ndk}
				icon={<MessageSquare className="w-6 h-6" />}
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
