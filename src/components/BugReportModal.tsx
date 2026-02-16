import { BugReportItem } from '@/components/BugReportItem'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useBugReportsInfiniteScroll } from '@/hooks/useBugReportsInfiniteScroll'
import { BLOSSOM_SERVERS, uploadFileToBlossom } from '@/lib/blossom'
import { BUG_RELAY } from '@/lib/constants'
import { ndkActions } from '@/lib/stores/ndk'
import { withTimeout } from '@/lib/utils/timeout'
import { cn } from '@/lib/utils'
import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

interface BugReportModalProps {
	isOpen: boolean
	onClose: () => void
	onReopen: () => void
}

export function BugReportModal({ isOpen, onClose, onReopen }: BugReportModalProps) {
	const [activeTab, setActiveTab] = useState<'report' | 'viewer'>('report')
	const [bugReport, setBugReport] = useState(
		'Describe the problem you are having:\n\n\n\nUse the drag and drop or paste to add images of the problem.\n\n\n\nWhat device and operating system are you using?\n\nWhat steps did you take to reproduce the problem?\n\n\n\nWhat did you expect to happen?\n\n\n\nWhat actually happened?\n\n\n\nPlease provide any other relevant information\n\n',
	)
	const textareaRef = useRef<HTMLTextAreaElement>(null)
	const [isUploading, setIsUploading] = useState(false)
	const [hasAutoPopulated, setHasAutoPopulated] = useState(false)
	const [isDragOver, setIsDragOver] = useState(false)
	const [uploadedImages, setUploadedImages] = useState<string[]>([])

	// Infinite scroll for bug reports viewer
	const {
		reports,
		hasMore,
		isLoading: isLoadingReports,
		loadMore,
	} = useBugReportsInfiniteScroll({
		chunkSize: 10,
		maxReports: 100,
		threshold: 1000,
		autoLoad: true,
	})

	// Gather system information from browser
	const getSystemInfo = () => {
		const info = {
			userAgent: navigator.userAgent,
			platform: navigator.platform,
			language: navigator.language,
			languages: navigator.languages?.join(', '),
			cookieEnabled: navigator.cookieEnabled,
			onLine: navigator.onLine,
			screenResolution: `${screen.width}x${screen.height}`,
			screenColorDepth: screen.colorDepth,
			timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			viewportSize: `${window.innerWidth}x${window.innerHeight}`,
			devicePixelRatio: window.devicePixelRatio,
			touchSupport: 'ontouchstart' in window,
			webglSupport: !!document.createElement('canvas').getContext('webgl'),
			webgl2Support: !!document.createElement('canvas').getContext('webgl2'),
			serviceWorkerSupport: 'serviceWorker' in navigator,
			notificationSupport: 'Notification' in window,
			geolocationSupport: 'geolocation' in navigator,
			localStorageSupport: typeof Storage !== 'undefined',
			sessionStorageSupport: typeof Storage !== 'undefined',
		}

		return `Device: ${info.platform}
Operating System: ${info.userAgent.split('(')[1]?.split(')')[0] || 'Unknown'}
Browser: ${info.userAgent.split(' ').slice(-2).join(' ')}
Language: ${info.language} (${info.languages})
Screen Resolution: ${info.screenResolution}
Viewport Size: ${info.viewportSize}
Color Depth: ${info.screenColorDepth} bits
Device Pixel Ratio: ${info.devicePixelRatio}
Timezone: ${info.timezone}
Touch Support: ${info.touchSupport ? 'Yes' : 'No'}
WebGL Support: ${info.webglSupport ? 'Yes' : 'No'}
WebGL2 Support: ${info.webgl2Support ? 'Yes' : 'No'}
Service Worker: ${info.serviceWorkerSupport ? 'Yes' : 'No'}
Notifications: ${info.notificationSupport ? 'Yes' : 'No'}
Geolocation: ${info.geolocationSupport ? 'Yes' : 'No'}
Local Storage: ${info.localStorageSupport ? 'Yes' : 'No'}
Session Storage: ${info.sessionStorageSupport ? 'Yes' : 'No'}
Online: ${info.onLine ? 'Yes' : 'No'}
Cookies: ${info.cookieEnabled ? 'Enabled' : 'Disabled'}`
	}

	// Upload image to Blossom using the merged blossom upload code
	const uploadToBlossom = async (file: File) => {
		try {
			console.log('Uploading to Blossom using merged upload code...')

			// Use the merged blossom upload function
			const result = await uploadFileToBlossom(file, {
				preferredServer: BLOSSOM_SERVERS[0].url, // Use first available server
				onProgress: (progress: { loaded: number; total: number }) => {
					const pct = Math.round((progress.loaded / progress.total) * 100)
					console.log(`Upload progress: ${pct}%`)
				},
				maxRetries: 3,
			})

			console.log('Blossom upload successful:', result)
			return result
		} catch (error) {
			console.error('Blossom upload error:', error)
			throw error
		}
	}

	// Auto-populate system information when modal opens
	useEffect(() => {
		if (isOpen && !hasAutoPopulated) {
			const systemInfo = getSystemInfo()
			const systemInfoInsertText = 'What device and operating system are you using?\n\n'
			const systemInfoInsertIndex = bugReport.indexOf(systemInfoInsertText)

			if (systemInfoInsertIndex !== -1) {
				const beforeInsert = bugReport.substring(0, systemInfoInsertIndex + systemInfoInsertText.length)
				const afterInsert = bugReport.substring(systemInfoInsertIndex + systemInfoInsertText.length)
				const newText = beforeInsert + `${systemInfo}\n\n` + afterInsert
				setBugReport(newText)
				setHasAutoPopulated(true)
			}
		}
	}, [isOpen, hasAutoPopulated, bugReport])

	// Insert uploaded image URLs into the text
	const insertImageUrl = (imageUrl: string) => {
		const imageInsertText = 'Use the drag and drop or paste to add images of the problem.\n\n\n\n'
		const imageInsertIndex = bugReport.indexOf(imageInsertText)

		if (imageInsertIndex !== -1) {
			const beforeInsert = bugReport.substring(0, imageInsertIndex + imageInsertText.length)
			const afterInsert = bugReport.substring(imageInsertIndex + imageInsertText.length)

			// If this is the first image, insert it. If not, add it on a new line after existing images
			const existingImages = uploadedImages.length
			const imageText = existingImages === 0 ? `[Image: ${imageUrl}]\n\n` : `\n[Image: ${imageUrl}]\n\n`

			const newText = beforeInsert + imageText + afterInsert
			setBugReport(newText)
			setUploadedImages((prev) => [...prev, imageUrl])

			// Focus the textarea and position cursor after the inserted image
			setTimeout(() => {
				if (textareaRef.current) {
					textareaRef.current.focus()
					const cursorPos = beforeInsert.length + imageText.length
					textareaRef.current.setSelectionRange(cursorPos, cursorPos)
				}
			}, 100)
		} else {
			// Fallback: insert at end if pattern not found
			const imageText = uploadedImages.length === 0 ? `\n[Image: ${imageUrl}]\n` : `\n[Image: ${imageUrl}]\n`

			const newText = bugReport + imageText
			setBugReport(newText)
			setUploadedImages((prev) => [...prev, imageUrl])

			setTimeout(() => {
				if (textareaRef.current) {
					textareaRef.current.focus()
					textareaRef.current.setSelectionRange(newText.length, newText.length)
				}
			}, 100)
		}
	}

	// Cleanup effect to reset states when modal closes
	useEffect(() => {
		if (!isOpen) {
			setActiveTab('report')
			setIsUploading(false)
			setHasAutoPopulated(false)
			setUploadedImages([])
			// Reset to default template for next time
			setBugReport(
				'Describe the problem you are having:\n\n\n\nUse the drag and drop or paste to add images of the problem.\n\n\n\nWhat device and operating system are you using?\n\nWhat steps did you take to reproduce the problem?\n\n\n\nWhat did you expect to happen?\n\n\n\nWhat actually happened?\n\n\n\nPlease provide any other relevant information\n\n',
			)
		}
	}, [isOpen])

	const handleSend = async () => {
		try {
			console.log('Starting bug report send process...')

			// Get NDK instance
			const ndk = await ndkActions.getNDK()
			if (!ndk) {
				console.error('NDK not available')
				return
			}
			console.log('NDK instance obtained:', !!ndk)

			// Ensure bugs.plebeian.market relay is added for bug reports
			const relayAdded = ndkActions.addSingleRelay(BUG_RELAY)
			console.log('Bug relay added:', relayAdded)

			// Check if we have a signer
			if (!ndk.signer) {
				console.error('No signer available - user not authenticated')
				return
			}
			console.log('Signer available:', !!ndk.signer)

			// Ensure NDK is connected
			try {
				console.log('Ensuring NDK connection...')
				await ndk.connect()
				console.log('NDK connection ensured')
			} catch (connectError) {
				console.warn('NDK connection warning:', connectError)
			}

			// Create kind 1 event (text note)
			const event = new NDKEvent(ndk)
			event.kind = 1
			event.content = bugReport

			// Add plebian2beta tag
			event.tags = [['t', 'plebian2beta']]

			console.log('Event created:', {
				kind: event.kind,
				contentLength: event.content.length,
				tags: event.tags,
			})

			// Sign and publish the event
			console.log('Signing event...')
			await event.sign()
			console.log('Event signed, ID:', event.id)

			console.log('Publishing event to bug relay only...')

			// Publish only to the bug relay - never to public relays
			const bugRelaySet = NDKRelaySet.fromRelayUrls([BUG_RELAY], ndk)
			await withTimeout(event.publish(bugRelaySet), 10000, 'Publish bug report')
			console.log('Event published successfully!')

			// Log the event details for debugging
			console.log('Published event details:', {
				id: event.id,
				pubkey: event.pubkey,
				kind: event.kind,
				created_at: event.created_at,
				tags: event.tags,
				content: event.content.substring(0, 100) + '...',
			})

			// Clear the input and close modal after sending
			setBugReport(
				'Describe the problem you are having:\n\n\n\nUse the drag and drop or paste to add images of the problem.\n\n\n\nWhat device and operating system are you using?\n\nWhat steps did you take to reproduce the problem?\n\n\n\nWhat did you expect to happen?\n\n\n\nWhat actually happened?\n\n\n\nPlease provide any other relevant information\n\n',
			)
			onClose()
		} catch (error) {
			console.error('Failed to publish bug report:', error)
			if (error instanceof Error) {
				console.error('Error details:', {
					name: error.name,
					message: error.message,
					stack: error.stack,
				})
			} else {
				console.error('Unknown error type:', error)
			}
		}
	}

	// Handle file upload
	const handleFileUpload = async (file: File) => {
		if (!file.type.startsWith('image/')) {
			console.error('Only image files are supported')
			return
		}

		setIsUploading(true)
		try {
			const result = await uploadToBlossom(file)
			const imageUrl = result.url
			insertImageUrl(imageUrl)
			console.log('Image uploaded:', imageUrl)
		} catch (error) {
			console.error('Image upload failed:', error)
		} finally {
			setIsUploading(false)
		}
	}

	// Handle drag and drop
	const handleDragOver = (e: React.DragEvent) => {
		e.preventDefault()
		setIsDragOver(true)
	}

	const handleDragLeave = (e: React.DragEvent) => {
		e.preventDefault()
		setIsDragOver(false)
	}

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault()
		setIsDragOver(false)

		const files = Array.from(e.dataTransfer.files)
		files.forEach((file) => {
			if (file.type.startsWith('image/')) {
				handleFileUpload(file)
			}
		})
	}

	// Handle paste
	const handlePaste = (e: React.ClipboardEvent) => {
		const items = Array.from(e.clipboardData.items)
		items.forEach((item) => {
			if (item.type.startsWith('image/')) {
				const file = item.getAsFile()
				if (file) {
					handleFileUpload(file)
				}
			}
		})
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Escape') {
			onClose()
		}
	}

	if (!isOpen) return null

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
			onClick={onClose}
			onKeyDown={handleKeyDown}
		>
			<div className="bg-white rounded-lg shadow-xl w-[40em] h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
				{/* Header */}
				<div className="flex items-center justify-between border-b border-gray-200 p-6">
					<div className="flex items-center gap-2">
						<Button
							variant={activeTab === 'report' ? 'primary' : 'outline'}
							size="sm"
							onClick={() => setActiveTab('report')}
							className={cn('flex items-center gap-2', activeTab !== 'report' && 'text-gray-700 border-gray-300')}
						>
							<span className="i-warning w-4 h-4" />
							Bug Report
						</Button>
						<Button
							variant={activeTab === 'viewer' ? 'primary' : 'outline'}
							size="sm"
							onClick={() => setActiveTab('viewer')}
							className={cn('flex items-center gap-2', activeTab !== 'viewer' && 'text-gray-700 border-gray-300')}
						>
							<span className="i-search w-4 h-4" />
							Report Viewer
						</Button>
					</div>
					<Button
						variant="ghost"
						size="icon"
						onClick={onClose}
						className="h-8 w-8 text-gray-500 hover:text-gray-700"
						aria-label="Close bug report modal"
					>
						<span className="i-close w-5 h-5" />
					</Button>
				</div>

				{/* Content */}
				<div className="flex-1 flex flex-col px-6 pt-0 pb-6 min-h-0">
					{activeTab === 'report' ? (
						<>
							<Alert className="bg-blue-100 text-blue-800 border-blue-200 mb-4">
								<AlertDescription>
									Report a bug you have found. Use the drag and drop or paste to add images of the problem. The details of your system
									configuration have been automatically added.
								</AlertDescription>
							</Alert>
							<div className="flex-1 flex flex-col min-h-0">
								<textarea
									ref={textareaRef}
									value={bugReport}
									onChange={(e) => setBugReport(e.target.value)}
									onPaste={handlePaste}
									onDragOver={handleDragOver}
									onDragLeave={handleDragLeave}
									onDrop={handleDrop}
									placeholder="Describe the bug you encountered..."
									className={cn(
										'flex-1 w-full p-4 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-secondary focus:border-transparent text-gray-900 placeholder:text-gray-400',
										isDragOver && 'border-secondary bg-secondary/5',
										isUploading && 'opacity-50',
									)}
									rows={10}
									disabled={isUploading}
								/>
								{isDragOver && (
									<div className="absolute inset-0 flex items-center justify-center bg-secondary/10 border-2 border-dashed border-secondary rounded-lg pointer-events-none">
										<p className="text-secondary font-medium">Drop image files here</p>
									</div>
								)}
								{isUploading && (
									<div className="absolute inset-0 flex items-center justify-center bg-white/80 rounded-lg pointer-events-none">
										<p className="text-gray-600 font-medium">Uploading image...</p>
									</div>
								)}
							</div>
						</>
					) : (
						<>
							<Alert className="bg-blue-100 text-blue-800 border-blue-200 mb-4">
								<AlertDescription>View bug reports from the community</AlertDescription>
							</Alert>
							<div className="flex-1 overflow-y-auto min-h-0">
								{isLoadingReports && reports.length === 0 ? (
									<div className="flex flex-col items-center justify-center py-12">
										<Loader2 className="w-8 h-8 animate-spin mb-4" />
										<p className="text-gray-600">Loading bug reports...</p>
									</div>
								) : reports.length === 0 ? (
									<div className="flex flex-col items-center justify-center py-12 text-center">
										<h3 className="text-lg font-semibold text-gray-900 mb-2">No bug reports found</h3>
										<p className="text-gray-600">There are no bug reports available at the moment.</p>
									</div>
								) : (
									<div className="space-y-4">
										{reports.map((report) => (
											<BugReportItem key={report.id} report={report} />
										))}
										{hasMore && (
											<div className="flex justify-center py-4">
												<Button onClick={loadMore} variant="outline" disabled={isLoadingReports}>
													{isLoadingReports ? (
														<>
															<Loader2 className="w-4 h-4 animate-spin mr-2" />
															Loading...
														</>
													) : (
														'Load More Reports'
													)}
												</Button>
											</div>
										)}
									</div>
								)}
							</div>
						</>
					)}
				</div>

				{/* Footer */}
				{activeTab === 'report' && (
					<div className="flex justify-end items-center p-6 border-t border-gray-200">
						<Button
							onClick={handleSend}
							disabled={!bugReport.trim() || isUploading}
							className="flex items-center gap-2 bg-secondary hover:bg-secondary/90 text-white"
						>
							<span className="i-send-message w-4 h-4" />
							Send
						</Button>
					</div>
				)}
			</div>
		</div>
	)
}
