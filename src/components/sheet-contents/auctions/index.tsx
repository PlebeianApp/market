import { SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { AuctionFormContent } from './AuctionFormContent'

export function NewAuctionContent({ title, description }: { title?: string; description?: string }) {
	return (
		<SheetContent
			side="right"
			className="flex flex-col max-h-screen overflow-hidden w-[100vw] sm:min-w-[85vw] md:min-w-[55vw] xl:min-w-[35vw] p-6"
		>
			<SheetHeader>
				<SheetTitle className="text-center">{title || 'Create Auction'}</SheetTitle>
				<SheetDescription className="hidden">{description || 'Create a new auction listing'}</SheetDescription>
			</SheetHeader>

			<AuctionFormContent />
		</SheetContent>
	)
}

export { AuctionFormContent } from './AuctionFormContent'
