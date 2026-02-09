import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Circle, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface MigrationStep {
	id: string
	label: string
	status: 'pending' | 'active' | 'complete' | 'error'
}

export interface RelayStatus {
	url: string
	status: 'pending' | 'success' | 'error'
}

interface MigrationProgressDialogProps {
	open: boolean
	steps: MigrationStep[]
	relayStatuses: RelayStatus[]
	error?: string
	onRetry?: () => void
	onCancel?: () => void
}

function StepIcon({ status }: { status: MigrationStep['status'] }) {
	switch (status) {
		case 'pending':
			return <Circle className="w-5 h-5 text-muted-foreground" />
		case 'active':
			return <Loader2 className="w-5 h-5 text-primary animate-spin" />
		case 'complete':
			return <CheckCircle2 className="w-5 h-5 text-green-600" />
		case 'error':
			return <XCircle className="w-5 h-5 text-destructive" />
	}
}

function RelayStatusIcon({ status }: { status: RelayStatus['status'] }) {
	switch (status) {
		case 'pending':
			return <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
		case 'success':
			return <CheckCircle2 className="w-4 h-4 text-green-600" />
		case 'error':
			return <XCircle className="w-4 h-4 text-destructive" />
	}
}

export function MigrationProgressDialog({ open, steps, relayStatuses, error, onRetry, onCancel }: MigrationProgressDialogProps) {
	const completedRelays = relayStatuses.filter((r) => r.status === 'success').length
	const totalRelays = relayStatuses.length
	const progressPercent = totalRelays > 0 ? (completedRelays / totalRelays) * 100 : 0

	const isPublishing = steps.find((s) => s.id === 'publishing')?.status === 'active'
	const hasError = steps.some((s) => s.status === 'error') || !!error
	const isComplete = steps.every((s) => s.status === 'complete')

	return (
		<DialogPrimitive.Root open={open}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
				<DialogPrimitive.Content
					className="bg-background fixed top-[50%] left-[50%] z-50 w-full max-w-md translate-x-[-50%] translate-y-[-50%] rounded-lg border p-6 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
					onPointerDownOutside={(e) => e.preventDefault()}
					onEscapeKeyDown={(e) => e.preventDefault()}
				>
					<div className="flex flex-col gap-4">
						<DialogPrimitive.Title className="text-lg font-semibold text-center">
							{hasError ? 'Migration Failed' : isComplete ? 'Migration Complete' : 'Migrating Product...'}
						</DialogPrimitive.Title>

						{/* Steps */}
						<div className="space-y-3">
							{steps.map((step) => {
								// Style the final "complete" step differently
								if (step.id === 'complete') {
									if (step.status !== 'complete') return null
									return (
										<div key={step.id} className="flex items-center gap-3 pt-2 border-t">
											<CheckCircle2 className="w-6 h-6 text-green-600" />
											<span className="text-sm font-medium text-green-600">{step.label}</span>
										</div>
									)
								}
								return (
									<div key={step.id} className="flex items-center gap-3">
										<StepIcon status={step.status} />
										<span
											className={cn(
												'text-sm',
												step.status === 'pending' && 'text-muted-foreground',
												step.status === 'active' && 'text-foreground font-medium',
												step.status === 'complete' && 'text-muted-foreground',
												step.status === 'error' && 'text-destructive',
											)}
										>
											{step.label}
										</span>
									</div>
								)
							})}
						</div>

						{/* Relay Status (shown during publishing) */}
						{isPublishing && relayStatuses.length > 0 && (
							<div className="border rounded-md p-3 space-y-2">
								<div className="text-xs text-muted-foreground font-medium">Relay Status</div>
								<div className="space-y-1.5 max-h-32 overflow-y-auto">
									{relayStatuses.map((relay) => (
										<div key={relay.url} className="flex items-center gap-2 text-xs">
											<RelayStatusIcon status={relay.status} />
											<span className="truncate text-muted-foreground">{relay.url.replace('wss://', '')}</span>
										</div>
									))}
								</div>
								<div className="pt-2">
									<Progress value={progressPercent} className="h-1.5" />
									<div className="text-xs text-muted-foreground mt-1 text-center">
										{completedRelays} of {totalRelays} relays
									</div>
								</div>
							</div>
						)}

						{/* Error Message */}
						{error && (
							<div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
								<p className="text-sm text-destructive">{error}</p>
							</div>
						)}

						{/* Actions (only show on error) */}
						{hasError && (
							<div className="flex gap-2 justify-end pt-2">
								{onCancel && (
									<Button variant="outline" onClick={onCancel}>
										Cancel
									</Button>
								)}
								{onRetry && (
									<Button variant="secondary" onClick={onRetry}>
										Try Again
									</Button>
								)}
							</div>
						)}
					</div>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	)
}
