import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndkActions } from '@/lib/stores/ndk'
import { uploadToBlossomServer, BLOSSOM_SERVERS } from '@/lib/blossom'
import html2canvas from 'html2canvas'

interface BugReportModalProps {
	isOpen: boolean
	onClose: () => void
	onReopen: () => void
}

export function BugReportModal({ isOpen, onClose, onReopen }: BugReportModalProps) {
	const [bugReport, setBugReport] = useState('Describe the problem you are having:\n\n\n\nUse the screenshot button to add a screenshot of the problem.\n\n\n\nWhat device and operating system are you using?\n\nWhat steps did you take to reproduce the problem?\n\n\n\nWhat did you expect to happen?\n\n\n\nWhat actually happened?\n\n\n\nPlease provide any other relevant information.')
	const textareaRef = useRef<HTMLTextAreaElement>(null)
	const [pendingScreenshotUrl, setPendingScreenshotUrl] = useState<string | null>(null)
	const [isCapturing, setIsCapturing] = useState(false)
	const [hasAutoPopulated, setHasAutoPopulated] = useState(false)

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
			sessionStorageSupport: typeof Storage !== 'undefined'
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
	const uploadToBlossom = async (blob: Blob, filename: string) => {
		try {
			console.log('Uploading to Blossom using merged upload code...')
			
			// Convert blob to File object
			const file = new File([blob], filename, { type: blob.type })
			
			// Use the merged blossom upload function
			const result = await uploadToBlossomServer(file, {
				serverUrl: BLOSSOM_SERVERS[0].url, // Use first available server
				onProgress: (loaded, total) => {
					const pct = Math.round((loaded / total) * 100)
					console.log(`Upload progress: ${pct}%`)
				},
				maxRetries: 3,
				retryDelay: 2000
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

	// Handle inserting screenshot URL when modal reopens
	useEffect(() => {
		if (isOpen && pendingScreenshotUrl && textareaRef.current) {
			const screenshotInsertText = 'Use the screenshot button to add a screenshot of the problem.\n\n\n\n'
			const screenshotInsertIndex = bugReport.indexOf(screenshotInsertText)
			
			console.log('Screenshot insertion:', {
				hasPendingScreenshotUrl: !!pendingScreenshotUrl,
				insertText: screenshotInsertText,
				insertIndex: screenshotInsertIndex,
				textLength: bugReport.length
			})
			
			if (screenshotInsertIndex !== -1) {
				const beforeInsert = bugReport.substring(0, screenshotInsertIndex + screenshotInsertText.length)
				const afterInsert = bugReport.substring(screenshotInsertIndex + screenshotInsertText.length)
				const newText = beforeInsert + `[Screenshot: ${pendingScreenshotUrl}]\n\n` + afterInsert
				
				setBugReport(newText)
				setPendingScreenshotUrl(null)
				
				console.log('Screenshot inserted at position:', screenshotInsertIndex)
				
				// Focus the textarea and position cursor after the inserted screenshot
				setTimeout(() => {
					if (textareaRef.current) {
						textareaRef.current.focus()
						const cursorPos = beforeInsert.length + `[Screenshot: ${pendingScreenshotUrl}]\n\n`.length
						textareaRef.current.setSelectionRange(cursorPos, cursorPos)
					}
				}, 100)
			} else {
				// Fallback: insert at end if pattern not found
				const newText = bugReport + `\n[Screenshot: ${pendingScreenshotUrl}]\n`
				setBugReport(newText)
				setPendingScreenshotUrl(null)
				
				console.log('Screenshot inserted at end (fallback)')
				
				setTimeout(() => {
					if (textareaRef.current) {
						textareaRef.current.focus()
						textareaRef.current.setSelectionRange(newText.length, newText.length)
					}
				}, 100)
			}
		}
	}, [isOpen, pendingScreenshotUrl, bugReport])

	// Cleanup effect to reset states when modal closes
	useEffect(() => {
		if (!isOpen) {
			setIsCapturing(false)
			setHasAutoPopulated(false)
			// Reset to default template for next time
			setBugReport('Describe the problem you are having:\n\n\n\nUse the screenshot button to add a screenshot of the problem.\n\n\n\nWhat device and operating system are you using?\n\nWhat steps did you take to reproduce the problem?\n\n\n\nWhat did you expect to happen?\n\n\n\nWhat actually happened?\n\n\n\nPlease provide any other relevant information.')
		}
	}, [isOpen])

	const handleSend = async () => {
		try {
			// Get NDK instance
			const ndk = await ndkActions.getNDK()
			if (!ndk) {
				console.error('NDK not available')
				return
			}

			// Ensure test.orly.dev relay is added for bug reports
			ndkActions.addSingleRelay('wss://test.orly.dev/')

			// Create kind 1 event (text note)
			const event = new NDKEvent(ndk)
			event.kind = 1
			event.content = bugReport
			
			// Add plebian2beta tag
			event.tags = [['t', 'plebian2beta']]

			// Sign and publish the event
			await event.sign()
			await event.publish()

			console.log('Bug report published:', event.id)
			
			// Clear the input and close modal after sending
			setBugReport('Describe the problem you are having:\n\n\n\nUse the screenshot button to add a screenshot of the problem.\n\n\n\nWhat device and operating system are you using?\n\nWhat steps did you take to reproduce the problem?\n\n\n\nWhat did you expect to happen?\n\n\n\nWhat actually happened?\n\n\n\nPlease provide any other relevant information.')
			onClose()
		} catch (error) {
			console.error('Failed to publish bug report:', error)
		}
	}

	const handleScreenshot = async () => {
		let safetyTimeout: NodeJS.Timeout | null = null
		
		try {
			// Close modal first
			onClose()
			
			// Wait a bit for modal to close
			await new Promise(resolve => setTimeout(resolve, 300))
			
			// Capture screenshot of the entire page
			const canvas = await html2canvas(document.body, {
				height: window.innerHeight,
				width: window.innerWidth,
				useCORS: false,
				allowTaint: true,
				scale: 1,
				logging: false,
				ignoreElements: (element) => {
					// Skip problematic elements
					if (element.tagName === 'IMG' && (element as HTMLImageElement).src?.includes('logo.svg')) {
						return true
					}
					// Skip elements with oklab colors
					if ((element as HTMLElement).style && (element as HTMLElement).style.color?.includes('oklab')) {
						return true
					}
					return false
				},
				onclone: (clonedDoc) => {
					// Fix oklab color functions by replacing them with fallback colors
					const allElements = clonedDoc.querySelectorAll('*')
					allElements.forEach((element) => {
						if (element instanceof HTMLElement) {
							const computedStyle = window.getComputedStyle(element)
							if (computedStyle.color?.includes('oklab')) {
								element.style.color = 'rgb(0, 0, 0)'
							}
							if (computedStyle.backgroundColor?.includes('oklab')) {
								element.style.backgroundColor = 'rgb(255, 255, 255)'
							}
						}
					})
				}
			})
			
			// Convert canvas to blob
			const blob = await new Promise<Blob>((resolve) => {
				canvas.toBlob((blob) => {
					if (blob) resolve(blob)
				}, 'image/png', 0.9)
			})
			
			// Upload to Blossom using Nostr authentication
			const result = await uploadToBlossom(blob, 'screenshot.png')
			const imageUrl = result.url
			
			// Trigger white flash effect after successful upload
			setIsCapturing(true)
			
			// Safety timeout to reset flash state (5 seconds max)
			safetyTimeout = setTimeout(() => {
				setIsCapturing(false)
			}, 5000)

			// Wait for flash to fade in
			await new Promise(resolve => setTimeout(resolve, 100))

			// Fade out the flash effect
			await new Promise(resolve => setTimeout(resolve, 100))
			setIsCapturing(false)
			if (safetyTimeout) clearTimeout(safetyTimeout)

			// Store only the screenshot URL (system info is populated separately)
			console.log('Setting pending screenshot URL:', imageUrl)
			setPendingScreenshotUrl(imageUrl)

			// Reopen modal
			setTimeout(() => {
				onReopen()
				console.log('Screenshot uploaded:', imageUrl)
			}, 100)
		} catch (error) {
			console.error('Screenshot capture failed:', error)
			// Reopen modal even if screenshot failed
			setTimeout(() => {
				onReopen()
			}, 100)
		}
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Escape') {
			onClose()
		}
	}

	if (!isOpen) return null

	return (
		<>
			{/* White flash overlay for screenshot capture */}
			{isCapturing && (
				<div 
					className="fixed inset-0 z-[9999] bg-white transition-opacity duration-100 ease-in-out"
					style={{
						animation: 'flashFade 200ms ease-in-out'
					}}
				/>
			)}
			
			<div
				className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
				onClick={onClose}
				onKeyDown={handleKeyDown}
			>
			<div 
				className="bg-white rounded-lg shadow-xl w-[28em] h-[80vh] flex flex-col"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="flex items-center justify-between p-6 border-b border-gray-200">
					<h2 className="text-xl font-semibold text-gray-900">Bug Report</h2>
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
					<p className="text-gray-600 mb-6">Report a bug you have found</p>
					
					<div className="flex-1 flex flex-col">
						<textarea
							ref={textareaRef}
							value={bugReport}
							onChange={(e) => setBugReport(e.target.value)}
							placeholder="Describe the bug you encountered..."
							className="flex-1 w-full p-4 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-secondary focus:border-transparent"
							rows={10}
						/>
					</div>
				</div>

						{/* Footer */}
						<div className="flex justify-between items-center p-6 border-t border-gray-200">
							<div className="flex gap-2">
								<Button
									onClick={handleScreenshot}
									variant="outline"
									className="flex items-center gap-2"
								>
									<span className="i-camera w-4 h-4" />
									Screenshot
								</Button>
							</div>

							<Button
								onClick={handleSend}
								disabled={!bugReport.trim()}
								className="flex items-center gap-2 bg-secondary hover:bg-secondary/90 text-white"
							>
								<span className="i-send-message w-4 h-4" />
								Send
							</Button>
						</div>
			</div>
		</div>
		</>
	)
}
