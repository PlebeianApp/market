import { BugReportItem } from '@/components/BugReportItem'
import { Button } from '@/components/ui/button'
import { useBugReportsInfiniteScroll } from '@/hooks/useBugReportsInfiniteScroll'
import { BLOSSOM_SERVERS, uploadFileToBlossom } from '@/lib/blossom'
import { ndkActions } from '@/lib/stores/ndk'
import { defaultRelaysUrls } from '@/lib/constants'
import { cn } from '@/lib/utils'
import NDK, { NDKEvent } from '@nostr-dev-kit/ndk'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

// Check for staging environment
const isStaging =
	(typeof process !== 'undefined' && process.env?.STAGING === 'true') ||
	(typeof import.meta !== 'undefined' && import.meta.env?.STAGING === 'true')

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
				serverUrl: BLOSSOM_SERVERS[0].url, // Use first available server
				onProgress: (loaded, total) => {
					const pct = Math.round((loaded / total) * 100)
					console.log(`Upload progress: ${pct}%`)
				},
				maxRetries: 3,
				retryDelay: 2000,
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

			// Create a separate NDK instance for bug reports to avoid contaminating the main instance
			// In staging mode, use only staging relay; in production, use bugs relay + defaults
			const bugReportRelays = isStaging 
				? ['wss://relay.staging.plebeian.market']
				: ['wss://bugs.plebeian.market/', ...defaultRelaysUrls]
				
			const bugReportNdk = new NDK({
				explicitRelayUrls: bugReportRelays
			})

			// Get the main NDK instance only to get the signer
			const mainNdk = ndkActions.getNDK()
			if (!mainNdk || !mainNdk.signer) {
				console.error('Main NDK not available or no signer')
				return
			}
			
			// Set the signer on the bug report NDK
			bugReportNdk.signer = mainNdk.signer
			console.log('🐛 Signer set on bug report NDK')

			// Connect the bug report NDK
			try {
				console.log('🐛 Connecting bug report NDK...')
				await bugReportNdk.connect()
				console.log('🐛 Bug report NDK connected')
			} catch (connectError) {
				console.warn('🐛 Bug report NDK connection warning:', connectError)
			}

			// Create kind 1 event (text note) using the bug report NDK
			const event = new NDKEvent(bugReportNdk)
			event.kind = 1
			event.content = bugReport

			// Add plebian2beta tag
			event.tags = [['t', 'plebian2beta']]

			console.log('Event created:', {
				kind: event.kind,
				contentLength: event.content.length,
				tags: event.tags,
			})

			// Sign and publish the event using the bug report NDK
			console.log('🐛 Signing event...')
			await event.sign()
			console.log('🐛 Event signed, ID:', event.id)

			console.log('🐛 Publishing event...')

			// Add timeout to publish operation
			const publishPromise = event.publish()
			const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Publish timeout after 10 seconds')), 10000))

			await Promise.race([publishPromise, timeoutPromise])
			console.log('🐛 Event published successfully!')
			console.log('🐛 Published to relays:', bugReportNdk.pool?.connectedRelays().map(r => r.url))
			
			// Clean up the bug report NDK
			bugReportNdk.pool?.relays.forEach(relay => relay.disconnect())

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
				<div className="flex items-center justify-between p-6 border-b border-gray-200">
					<div className="flex items-center gap-2">
						<Button
							variant={activeTab === 'report' ? 'primary' : 'outline'}
							size="sm"
							onClick={() => setActiveTab('report')}
							className="flex items-center gap-2"
						>
							<span className="i-warning w-4 h-4" />
							Bug Report
						</Button>
						<Button
							variant={activeTab === 'viewer' ? 'primary' : 'outline'}
							size="sm"
							onClick={() => setActiveTab('viewer')}
							className="flex items-center gap-2"
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
				<div className="flex-1 flex flex-col p-6">
					{activeTab === 'report' ? (
						<>
							<p className="text-gray-600 mb-6">Report a bug you have found</p>
							<p className="text-gray-600 mb-6">Use the drag and drop or paste to add images of the problem.</p>
							<p className="text-gray-600 mb-6">The details of your system configuration have been automatically added.</p>
							<div className="flex-1 flex flex-col">
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
										'flex-1 w-full p-4 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-secondary focus:border-transparent',
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
							<p className="text-gray-600 mb-6">View bug reports from the community</p>
							<div className="flex-1 overflow-y-auto">
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
