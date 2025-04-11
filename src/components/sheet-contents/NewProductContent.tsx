import { Button } from '@/components/ui/button'
import { SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet'

export function NewProductContent() {
	return (
		<SheetContent side="right">
			{/* This is for Accessibility but we don't need to show it */}
			<SheetHeader className="hidden">
				<SheetTitle>Welcome to Plebeian Market</SheetTitle>
				<SheetDescription>Start selling your products in just a few minutes</SheetDescription>
			</SheetHeader>
			<div className="flex flex-col h-full justify-between items-center px-4 pb-12">
				{/* Spacer */}
				<div />
				<div className="flex flex-col justify-center items-center gap-4">
					<div className="flex justify-center mt-8">
						<img src="/images/logo.svg" alt="Plebeian Market Logo" className="w-16 h-16" />
					</div>

					<h1 className="text-2xl font-heading text-balance text-center">Welcome to Plebeian Market</h1>
					<h2 className="text-xl font-display text-balance text-center">Start selling your products in just a few minutes</h2>
				</div>
				{/* Spacer */}
				<div />
				<Button variant="secondary" className="w-full">
					Let's Go
				</Button>
			</div>
		</SheetContent>
	)
}
