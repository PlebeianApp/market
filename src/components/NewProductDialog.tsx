import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'

interface NewProductDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
}

export function NewProductDialog({ open, onOpenChange }: NewProductDialogProps) {
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="w-full border-l-0 sm:w-3/4 sm:border-l md:max-w-md">
				<SheetHeader>
					<SheetTitle className="text-2xl">WELCOME TO</SheetTitle>
					<SheetTitle className="text-3xl">PLEBEIAN MARKET</SheetTitle>
					<SheetDescription className="text-lg">Start selling your products in just a few minutes</SheetDescription>
				</SheetHeader>
				<div className="flex justify-center mt-8">
					<img src="/images/logo.svg" alt="Plebeian Market Logo" className="w-16 h-16" />
				</div>
			</SheetContent>
		</Sheet>
	)
}
