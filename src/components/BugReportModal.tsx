import { BugReportItem } from '@/components/BugReportItem'
import { Button } from '@/components/ui/button'
import { useBugReportsInfiniteScroll } from '@/hooks/useBugReportsInfiniteScroll'
import { BLOSSOM_SERVERS, uploadFileToBlossom } from '@/lib/blossom'
import { ndkActions } from '@/lib/stores/ndk'
import { cn } from '@/lib/utils'
import { bugReportKeys } from '@/queries/bugReports'
import { useQueryClient } from '@tanstack/react-query'
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
	const queryClient = useQueryClient()
	const [activeTab, setActiveTab] = useState<'report' | 'viewer'>('report')
	const [bugReport, setBugReport] = useState(
		'Describe the problem you are having:\n\n\n\nUse the drag and drop or paste to add images of the problem.\n\n\n\nWhat device and operating system are you using?\n\nWhat steps did you take to reproduce the problem?\n\n\n\nWhat did you expect to happen?\n\n\n\nWhat actually happened?\n\n\n\nPlease provide any other relevant information\n\n',
	)
	const textareaRef = useRef<HTMLTextAreaElement>(null)
	const scrollContainerRef = useRef<HTMLDivElement>(null)
	const [isUploading, setIsUploading] = useState(false)
	const [isSending, setIsSending] = useState(false)
	const [sendStatus, setSendStatus] = useState<'idle' | 'success' | 'error'>('idle')
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
		scrollContainer: scrollContainerRef,
	})

	// Prevent body scrolling when modal is open
	useEffect(() => {
		if (isOpen) {
			document.body.style.overflow = 'hidden'
		} else {
			document.body.style.overflow = 'unset'
		}

		// Cleanup on unmount
		return () => {
			document.body.style.overflow = 'unset'
		}
	}, [isOpen])

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
				onProgress: ({ loaded, total }) => {
					const pct = Math.round((loaded / total) * 100)
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
			setIsSending(false)
			setSendStatus('idle')
			setHasAutoPopulated(false)
			setUploadedImages([])
			// Reset to default template for next time
			setBugReport(
				'Describe the problem you are having:\n\n\n\nUse the drag and drop or paste to add images of the problem.\n\n\n\nWhat device and operating system are you using?\n\nWhat steps did you take to reproduce the problem?\n\n\n\nWhat did you expect to happen?\n\n\n\nWhat actually happened?\n\n\n\nPlease provide any other relevant information\n\n',
			)
		}
	}, [isOpen])


	const handleSend = async () => {
		if (isSending) return // Prevent double submission
		
		setIsSending(true)
		setSendStatus('idle')
		
		let bugReportNdk: NDK | null = null
		
		try {
			console.log('Starting bug report send process...')

			// Create a separate NDK instance for bug reports to avoid contaminating the main instance
			// In staging mode, use only staging relay; in production, use only bugs relay
			const bugReportRelays = isStaging ? ['wss://relay.staging.plebeian.market'] : ['wss://bugs.plebeian.market/']
			console.log('🐛 Using bug report relays:', bugReportRelays)

			// Get the main NDK instance to get the signer FIRST
			const mainNdk = ndkActions.getNDK()
			if (!mainNdk || !mainNdk.signer) {
				console.error('Main NDK not available or no signer')
				setSendStatus('error')
				throw new Error('Main NDK not available or no signer')
			}

			console.log('🐛 Main NDK info:', {
				hasNdk: !!mainNdk,
				hasSigner: !!mainNdk.signer,
				signerType: mainNdk.signer?.constructor?.name,
				connectedRelays: mainNdk.pool?.connectedRelays()?.map(r => r.url) || []
			})

			// Create bug report NDK with signer from the start
			bugReportNdk = new NDK({
				explicitRelayUrls: bugReportRelays,
				signer: mainNdk.signer
			})
			
			console.log('🐛 Bug report NDK created with signer:', !!bugReportNdk.signer)
			console.log('🐛 Bug report NDK signer type:', bugReportNdk.signer?.constructor?.name)

			// Small delay to ensure signer is properly set
			await new Promise(resolve => setTimeout(resolve, 100))

			// Test direct WebSocket connection to check for CORS issues
			console.log('🐛 Testing direct WebSocket connection...')
			try {
				const testWs = new WebSocket(bugReportRelays[0])
				
				const wsTestPromise = new Promise((resolve, reject) => {
					const timeout = setTimeout(() => {
						testWs.close()
						reject(new Error('WebSocket test timeout'))
					}, 3000)
					
					testWs.onopen = () => {
						clearTimeout(timeout)
						console.log('🐛 Direct WebSocket connection successful')
						testWs.close()
						resolve('success')
					}
					
					testWs.onerror = (error) => {
						clearTimeout(timeout)
						console.error('🐛 Direct WebSocket connection failed:', error)
						reject(error)
					}
					
					testWs.onclose = (event) => {
						if (event.code !== 1000) { // 1000 is normal closure
							console.log('🐛 WebSocket closed with code:', event.code, 'reason:', event.reason)
						}
					}
				})
				
				await wsTestPromise
			} catch (wsError) {
				console.error('🐛 WebSocket test failed:', wsError)
				console.log('🐛 This might indicate CORS or network connectivity issues')
			}

			// Connect the bug report NDK with timeout
			console.log('🐛 Connecting bug report NDK...')
			console.log('🐛 NDK pool info before connect:', {
				hasPool: !!bugReportNdk.pool,
				relayCount: bugReportNdk.pool?.relays?.size || 0,
				relayUrls: Array.from(bugReportNdk.pool?.relays?.keys() || [])
			})
			
			const connectPromise = bugReportNdk.connect()
			const connectTimeoutPromise = new Promise((_, reject) => 
				setTimeout(() => reject(new Error('Connection timeout after 5 seconds')), 5000)
			)
			
			try {
				await Promise.race([connectPromise, connectTimeoutPromise])
				console.log('🐛 Bug report NDK connected successfully')
				
				// Verify connection
				const connectedRelays = bugReportNdk.pool?.connectedRelays() || []
				const allRelays = Array.from(bugReportNdk.pool?.relays?.values() || [])
				
				console.log('🐛 Connection status:', {
					connectedCount: connectedRelays.length,
					connectedUrls: connectedRelays.map(r => r.url),
					totalRelays: allRelays.length,
					allRelayUrls: allRelays.map(r => r.url),
					relayStatuses: allRelays.map(r => ({
						url: r.url,
						status: r.connectivity?.status,
						connected: r.connectivity?.connected
					}))
				})
				
				if (connectedRelays.length === 0) {
					console.warn('🐛 No relays connected!')
					// Let's try to wait a bit more for connection
					console.log('🐛 Waiting additional 2 seconds for connection...')
					await new Promise(resolve => setTimeout(resolve, 2000))
					
					const connectedAfterWait = bugReportNdk.pool?.connectedRelays() || []
					console.log('🐛 Connected after wait:', connectedAfterWait.map(r => r.url))
					
					if (connectedAfterWait.length === 0) {
						console.warn('🐛 Still no relays connected after waiting')
						console.warn('🐛 Bug reports can only be sent to the bugs relay - no fallback available')
					}
				}
			} catch (connectError) {
				console.error('🐛 Bug report NDK connection error:', connectError)
				console.log('🐛 Connection error details:', {
					message: connectError instanceof Error ? connectError.message : String(connectError),
					stack: connectError instanceof Error ? connectError.stack : undefined,
					relayCount: bugReportNdk.pool?.relays?.size || 0
				})
				
				// Check if this might be a CORS issue
				const errorMessage = connectError instanceof Error ? connectError.message : String(connectError)
				if (errorMessage.includes('CORS') || errorMessage.includes('cross-origin') || errorMessage.includes('blocked')) {
					console.warn('🐛 Possible CORS issue detected. The bugs relay might not allow connections from this origin.')
					console.log('🐛 Current origin:', window.location.origin)
					console.log('🐛 Relay URL:', bugReportRelays[0])
				}
				
				// Continue anyway - NDK might still work for publishing
			}

			// Create kind 1 event (text note) using the bug report NDK
			console.log('🐛 Creating event...')
			const event = new NDKEvent(bugReportNdk)
			event.kind = 1
			event.content = bugReport
			event.tags = [['t', 'plebian2beta']]

			console.log('🐛 Event created:', {
				kind: event.kind,
				contentLength: event.content.length,
				tags: event.tags,
				ndk: !!event.ndk,
				signer: !!event.ndk?.signer
			})

			// Sign the event
			console.log('🐛 Signing event...')
			try {
				await event.sign()
				console.log('🐛 Event signed successfully, ID:', event.id)
				console.log('🐛 Event pubkey:', event.pubkey)
			} catch (signError) {
				console.error('🐛 Failed to sign event:', signError)
				throw new Error(`Failed to sign event: ${signError instanceof Error ? signError.message : String(signError)}`)
			}

			// Publish the event
			console.log('🐛 Publishing event...')
			try {
				const publishPromise = event.publish()
				const publishTimeoutPromise = new Promise((_, reject) => 
					setTimeout(() => reject(new Error('Publish timeout after 15 seconds')), 15000)
				)

				const publishResult = await Promise.race([publishPromise, publishTimeoutPromise])
				console.log('🐛 Event published successfully!')
				console.log('🐛 Publish result size:', publishResult instanceof Set ? publishResult.size : 0)
				console.log('🐛 Published to relays:', publishResult instanceof Set ? Array.from(publishResult).map((r: any) => r.url) : [])
			} catch (publishError) {
				console.error('🐛 Failed to publish event:', publishError)
				throw new Error(`Failed to publish event: ${publishError instanceof Error ? publishError.message : String(publishError)}`)
			}

			// Log the event details for debugging
			console.log('Published event details:', {
				id: event.id,
				pubkey: event.pubkey,
				kind: event.kind,
				created_at: event.created_at,
				tags: event.tags,
				content: event.content.substring(0, 100) + '...',
			})

			// Invalidate bug reports cache to refresh the viewer
			console.log('🐛 Invalidating query cache...')
			await queryClient.invalidateQueries({ queryKey: bugReportKeys.all })
			
			setSendStatus('success')
			console.log('🐛 Bug report send completed successfully!')
			
			// Switch to viewer tab to show the new report
			console.log('🐛 Switching to report viewer...')
			setActiveTab('viewer')
			
			// Clear the input for next time
			setBugReport(
				'Describe the problem you are having:\n\n\n\nUse the drag and drop or paste to add images of the problem.\n\n\n\nWhat device and operating system are you using?\n\nWhat steps did you take to reproduce the problem?\n\n\n\nWhat did you expect to happen?\n\n\n\nWhat actually happened?\n\n\n\nPlease provide any other relevant information\n\n',
			)
			
			// Show success message briefly
			setTimeout(() => {
				setSendStatus('idle')
			}, 3000)
		} catch (error) {
			console.error('Failed to publish bug report:', error)
			setSendStatus('error')
			if (error instanceof Error) {
				console.error('Error details:', {
					name: error.name,
					message: error.message,
					stack: error.stack,
				})
			} else {
				console.error('Unknown error type:', error)
			}
		} finally {
			// Clean up the bug report NDK
			if (bugReportNdk) {
				console.log('🐛 Cleaning up bug report NDK...')
				bugReportNdk.pool?.relays.forEach((relay) => relay.disconnect())
			}
			setIsSending(false)
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
			onWheel={(e) => e.preventDefault()}
			onTouchMove={(e) => e.preventDefault()}
			style={{ overflow: 'hidden' }}
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
									onWheel={(e) => e.stopPropagation()}
									onTouchMove={(e) => e.stopPropagation()}
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
							<div className="mb-6">
								<p className="text-gray-600">View bug reports from the community</p>
								{sendStatus === 'success' && (
									<div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-lg">
										<p className="text-green-800 text-sm font-medium">✅ Bug report sent successfully!</p>
									</div>
								)}
							</div>
							<div
								ref={scrollContainerRef}
								className="flex-1 overflow-y-auto pr-2 min-h-0"
								style={{
									scrollbarWidth: 'thin',
									scrollbarColor: '#d1d5db #f3f4f6',
									maxHeight: 'calc(80vh - 200px)', // Ensure container has a defined max height
								}}
								onWheel={(e) => {
									// Allow scrolling within this container, but prevent bubbling to backdrop
									e.stopPropagation()
								}}
								onTouchMove={(e) => {
									// Allow touch scrolling within this container, but prevent bubbling to backdrop
									e.stopPropagation()
								}}
							>
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
						{sendStatus === 'error' && (
							<div className="text-red-600 text-sm mr-4">
								Failed to send bug report. Check console for details and try again.
							</div>
						)}
						{sendStatus === 'success' && (
							<div className="text-green-600 text-sm mr-4">
								Bug report sent successfully!
							</div>
						)}
						<Button
							onClick={() => {
								if (sendStatus === 'error') {
									setSendStatus('idle')
								}
								handleSend()
							}}
							disabled={!bugReport.trim() || isUploading || isSending || sendStatus === 'success'}
							className={cn(
								"flex items-center gap-2 text-white",
								sendStatus === 'success' 
									? "bg-green-600 hover:bg-green-600" 
									: "bg-secondary hover:bg-secondary/90"
							)}
						>
							{isSending ? (
								<>
									<Loader2 className="w-4 h-4 animate-spin" />
									Sending...
								</>
							) : sendStatus === 'success' ? (
								<>
									<span className="i-tick w-4 h-4" />
									Sent
								</>
							) : (
								<>
									<span className="i-send-message w-4 h-4" />
									Send
								</>
							)}
						</Button>
					</div>
				)}
			</div>
		</div>
	)
}
