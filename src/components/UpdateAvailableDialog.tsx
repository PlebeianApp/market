import { RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface UpdateAvailableDialogProps {
	open: boolean
	onDismiss: () => void
}

export function UpdateAvailableDialog({ open, onDismiss }: UpdateAvailableDialogProps) {
	const handleReload = () => {
		window.location.reload()
	}

	if (!open) return null

	return (
		<div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-4 fade-in duration-300">
			<div className="bg-background border rounded-lg shadow-lg p-4 max-w-sm">
				<div className="flex items-start gap-3">
					<div className="flex-shrink-0 mt-0.5">
						<RefreshCw className="size-5 text-primary" />
					</div>
					<div className="flex-1 min-w-0">
						<h4 className="text-sm font-semibold">Update Available</h4>
						<p className="text-sm text-muted-foreground mt-1">A new version is available. Reload to get the latest features.</p>
						<div className="flex gap-2 mt-3">
							<Button size="sm" variant="outline" onClick={onDismiss}>
								Later
							</Button>
							<Button size="sm" onClick={handleReload}>
								<RefreshCw className="size-3 mr-1.5" />
								Reload
							</Button>
						</div>
					</div>
					<button onClick={onDismiss} className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors">
						<X className="size-4" />
					</button>
				</div>
			</div>
		</div>
	)
}
