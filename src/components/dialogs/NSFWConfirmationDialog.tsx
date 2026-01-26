import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { uiActions, uiStore } from '@/lib/stores/ui'
import { useStore } from '@tanstack/react-store'
import { AlertTriangle } from 'lucide-react'

export function NSFWConfirmationDialog() {
	const { dialogs } = useStore(uiStore)
	const isOpen = dialogs['nsfw-confirmation']

	const handleConfirm = () => {
		uiActions.enableNSFWContent()
	}

	const handleCancel = () => {
		uiActions.closeDialog('nsfw-confirmation')
	}

	return (
		<Dialog open={isOpen} onOpenChange={(open) => !open && handleCancel()}>
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
					<Button variant="outline" onClick={handleCancel}>
						Cancel
					</Button>
					<Button onClick={handleConfirm} className="bg-amber-600 hover:bg-amber-700">
						I understand, show adult content
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
