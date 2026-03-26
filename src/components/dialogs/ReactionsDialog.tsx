import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { UserCard } from '@/components/UserCard'
import type { Reaction } from '@/queries/reactions'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { useState } from 'react'

interface ReactionsDialogProps {
	event: NDKEvent
	reactions: Map<string, Reaction[]>
	onOpenChange: (open: boolean) => void
}

export function ReactionsDialog({ event, reactions, onOpenChange }: ReactionsDialogProps) {
	const [activeTab, setActiveTab] = useState<string>(Array.from(reactions.keys())[0] ?? '')

	const reactionCount = reactions.size

	const handleDialogOpenChange = (open: boolean) => {
		if (!open) {
			setActiveTab(Array.from(reactions.keys())[0] ?? '')
		}
		onOpenChange(open)
	}

	return (
		<Dialog open={true} onOpenChange={handleDialogOpenChange}>
			<DialogContent className="max-w-[500px] max-h-[80vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>
						<span className="text-2xl">{Array.from(reactions.keys())[0]}</span>
						<span className="ml-2 text-muted-foreground">({reactionCount} reactions)</span>
					</DialogTitle>
				</DialogHeader>

				<Tabs defaultValue={Array.from(reactions.keys())[0] ?? ''} value={activeTab} onValueChange={setActiveTab}>
					<TabsList className="grid w-full grid-cols-2 gap-2 p-1">
						{Array.from(reactions.entries()).map(([emoji, reactionList]) => (
							<TabsTrigger key={emoji} value={emoji} className="flex items-center gap-2">
								<span className="text-xl">{emoji}</span>
								<span className="text-sm text-muted-foreground">({reactionList.length})</span>
							</TabsTrigger>
						))}
					</TabsList>

					{Array.from(reactions.entries()).map(([emoji, reactionList]) => (
						<TabsContent key={emoji} value={emoji} className="mt-2">
							<div className="space-y-2">
								{reactionList.map((r) => (
									<UserCard key={r.id} pubkey={r.authorPubkey} size="sm" />
								))}
							</div>
						</TabsContent>
					))}
				</Tabs>
			</DialogContent>
		</Dialog>
	)
}
