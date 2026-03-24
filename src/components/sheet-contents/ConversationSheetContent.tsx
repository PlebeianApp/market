import { ConversationView } from '@/components/messages/ConversationView'
import { SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useState } from 'react'
import { UserCard } from '../UserCard'

interface ConversationSheetContentProps {
	pubkey: string
}

export function ConversationSheetContent({ pubkey }: ConversationSheetContentProps) {
	const [title, setTitle] = useState('Messages')

	return (
		<SheetContent side="right" className="w-full sm:max-w-xl flex flex-col p-0">
			<SheetHeader className="p-6 pb-4 border-b">
				<SheetTitle className="flex items-center gap-2">
					<UserCard pubkey={pubkey} subtitle="npub" />
				</SheetTitle>
				<SheetDescription className="mt-2">Chat with this user</SheetDescription>
			</SheetHeader>
			<div className="flex-1 min-h-0 overflow-hidden">
				<ConversationView otherUserPubkey={pubkey} onTitleChange={setTitle} />
			</div>
		</SheetContent>
	)
}
