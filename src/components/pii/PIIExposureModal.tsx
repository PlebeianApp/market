import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { PIIScanResult } from '@/lib/utils/piiScanner'
import { deletePIIEvents, verifyDeletion } from '@/lib/utils/piiDeletion'
import { useAuth } from '@/lib/stores/auth'

export interface PIIExposureModalProps {
	isOpen: boolean
	onClose: () => void
	scanResult: PIIScanResult
}

type EventStatus = 'live' | 'deletion-requested' | 'not-returned'

export function PIIExposureModal({ isOpen, onClose, scanResult }: PIIExposureModalProps) {
	const [isProcessing, setIsProcessing] = useState(false)
	const [deletionRequested, setDeletionRequested] = useState(false)
	const [eventStatuses, setEventStatuses] = useState<Record<string, EventStatus>>({})
	const [verificationComplete, setVerificationComplete] = useState(false)
	const [verificationResult, setVerificationResult] = useState<{ verified: boolean; foundEvents: string[] } | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [isDismissed, setIsDismissed] = useState(false)
	const { user } = useAuth()
	const userPubkey = user?.pubkey

	// Initialize event statuses
	useEffect(() => {
		if (scanResult) {
			const statuses: Record<string, EventStatus> = {}
			scanResult.eventsWithPII.forEach((event) => {
				statuses[event.eventId] = 'live'
			})
			setEventStatuses(statuses)
		}
	}, [scanResult])

	// Check if warning was previously dismissed for this user
	useEffect(() => {
		if (!userPubkey) return

		const dismissedPubkeys = JSON.parse(sessionStorage.getItem('pii-warning-dismissed') || '[]')
		if (dismissedPubkeys.includes(userPubkey)) {
			setIsDismissed(true)
		}
	}, [userPubkey])

	const handleProcessEvents = async () => {
		if (!scanResult) return

		setIsProcessing(true)
		setError(null)

		try {
			// Step 1: Request deletion
			const deletionResult = await deletePIIEvents(scanResult.eventsWithPII.map((event) => event.eventId))

			if (!deletionResult.success) {
				setError(deletionResult.error || 'Failed to delete events')
				return
			}

			// Update statuses to "deletion-requested"
			const updatedStatuses: Record<string, EventStatus> = {}
			scanResult.eventsWithPII.forEach((event) => {
				updatedStatuses[event.eventId] = 'deletion-requested'
			})
			setEventStatuses(updatedStatuses)
			setDeletionRequested(true)

			// Step 2: Verify deletion
			const eventIds = scanResult.eventsWithPII.map((event) => event.eventId)
			const verifyResult = await verifyDeletion(eventIds, 10000)
			setVerificationResult(verifyResult)
			setVerificationComplete(true)

			// Update statuses based on verification
			const finalStatuses: Record<string, EventStatus> = {}
			scanResult.eventsWithPII.forEach((event) => {
				finalStatuses[event.eventId] = verifyResult.verified ? 'not-returned' : 'deletion-requested'
			})
			setEventStatuses(finalStatuses)
		} catch (err) {
			setError('An error occurred: ' + (err as Error).message)
			console.error('Processing error:', err)
		} finally {
			setIsProcessing(false)
		}
	}

	const handleDismiss = () => {
		// Add current user's pubkey to dismissed list
		if (userPubkey) {
			const dismissedPubkeys = JSON.parse(sessionStorage.getItem('pii-warning-dismissed') || '[]')
			if (!dismissedPubkeys.includes(userPubkey)) {
				dismissedPubkeys.push(userPubkey)
				sessionStorage.setItem('pii-warning-dismissed', JSON.stringify(dismissedPubkeys))
			}
		}
		setIsDismissed(true)
		onClose()
	}

	// Handle modal close
	const handleClose = () => {
		onClose()
	}

	// Determine overall status for the alert message
	const getOverallStatus = () => {
		if (error) return 'error'
		if (verificationComplete && verificationResult?.verified) return 'success'
		if (verificationComplete && !verificationResult?.verified) return 'warning'
		if (deletionRequested) return 'requested'
		return 'initial'
	}

	const overallStatus = getOverallStatus()

	return (
		<Dialog open={isOpen && !isDismissed} onOpenChange={handleClose}>
			<DialogContent className="sm:max-w-none sm:w-[calc(100%-2rem)] max-h-[90vh] overflow-scroll">
				<DialogHeader>
					<DialogTitle className="text-red-600">Some of your personal data may be exposed</DialogTitle>
				</DialogHeader>

				<Alert variant="destructive">
					<AlertDescription>
						A flaw in post-purchase shipping communication may have exposed some personal information (PII) publicly.
					</AlertDescription>
				</Alert>

				<div className="space-y-4">
					<div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
						<div className="flex">
							<div className="ml-3">
								<p className="text-sm text-yellow-700">
									<strong>Read all instructions carefully:</strong>
								</p>
								<ul className="mt-1 list-disc list-inside text-sm text-yellow-700 space-y-1">
									<li>
										<strong>Please avoid public posts about this leak to protect exposed community members</strong> and allow them to delete
										data before the official announcement. Do not share on Plebeian telegram or Nostr. A public announcement will follow
										once all affected users have deleted their data.
									</li>
									<li>
										<strong>On Nostr, users control their data.</strong> The Plebeian team cannot delete events for users, so this feature
										is added to detect and request event deletions automatically. Pressing the button below requests deletion and checks if
										any events remain.
									</li>
									<li>
										<strong>Deletion by relays isn't guaranteed</strong>, but tests show it usually works as events disappear from queries
										after deletion.
									</li>
									<li>Contact any team member (Chiefmonkey, Bekka, Maximotodev, Franchovy) for help or questions.</li>
								</ul>
							</div>
						</div>
					</div>

					<div>
						<h3 className="font-medium mb-2">Events containing PII:</h3>
						<ScrollArea className="h-40 border rounded p-2">
							<ul className="space-y-2 text-sm">
								{scanResult?.eventsWithPII.map((event) => {
									const status = eventStatuses[event.eventId] || 'live'
									let statusText = ''
									let statusClass = ''

									switch (status) {
										case 'live':
											statusText = 'Live'
											statusClass = 'text-red-600'
											break
										case 'deletion-requested':
											statusText = 'Deletion request sent'
											statusClass = 'text-orange-600'
											break
										case 'not-returned':
											statusText = 'Not returned in verification check'
											statusClass = 'text-green-600'
											break
									}

									return (
										<li key={event.eventId} className="flex flex-wrap items-center justify-between gap-2 p-2 border-b last:border-b-0">
											<div className="flex-1 min-w-0">
												<div className="font-medium break-words">Event {event.eventId.substring(0, 8)}...</div>
												<div className="text-gray-600 text-xs mt-1">
													Contains: {event.piiTags.join(', ')}
													{event.relayUrl && event.relayUrl !== 'unknown' && (
														<span className="ml-2">
															(on {event.relayUrl.includes('http') ? new URL(event.relayUrl).hostname : event.relayUrl})
														</span>
													)}
												</div>
											</div>
											<div className={`whitespace-nowrap text-sm font-medium ${statusClass}`}>{statusText}</div>
										</li>
									)
								})}
							</ul>
						</ScrollArea>
					</div>

					{overallStatus === 'success' && (
						<div className="p-4 rounded bg-green-100 border border-green-400">
							<div className="flex">
								<div className="ml-3">
									<p className="text-sm font-medium">✓ Success</p>
									<p className="text-sm mt-1">
										No matching events were returned by the relays checked during verification. Some relays or clients may still retain
										copies.
									</p>
								</div>
							</div>
						</div>
					)}

					{overallStatus === 'warning' && (
						<div className="p-4 rounded bg-yellow-100 border border-yellow-400">
							<div className="flex">
								<div className="ml-3">
									<p className="text-sm font-medium">⚠️ Partial Success</p>
									<p className="text-sm mt-1">
										Deletion requests have been sent, but {verificationResult?.foundEvents.length} events were still found. This could mean
										the relays have not processed the deletion requests yet.
									</p>
									<p className="text-sm mt-1">
										Please try again in a few minutes, or contact relay operators directly with event IDs to request deletion.
									</p>
								</div>
							</div>
						</div>
					)}

					{overallStatus === 'error' && (
						<div className="bg-red-50 border-l-4 border-red-400 p-4">
							<div className="flex">
								<div className="ml-3">
									<p className="text-sm text-red-700">
										<strong>Error:</strong> {error}
									</p>
								</div>
							</div>
						</div>
					)}

					<div className="flex">
						<div className="ml-3">
							<p className="text-sm text-center">
								Note: Deleting these events may disrupt ongoing or recent purchases. Resend shipping details privately via encrypted direct
								message to the seller.
							</p>
						</div>
					</div>

					<div className="flex flex-col sm:flex-row sm:items-center justify-center gap-4">
						<Button
							onClick={handleProcessEvents}
							disabled={isProcessing || overallStatus === 'success'}
							variant="destructive"
							className="w-full sm:w-auto"
						>
							{isProcessing ? 'Processing...' : 'Request Deletion and Verify'}
						</Button>
						<Button onClick={handleDismiss} variant="outline" className="w-full sm:w-auto">
							Dismiss Warning
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	)
}
