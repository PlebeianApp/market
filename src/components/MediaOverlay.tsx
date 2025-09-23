import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { XIcon, ZoomInIcon, ZoomOutIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MediaOverlayProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	src: string
	alt?: string
}

export function MediaOverlay({ open, onOpenChange, src, alt = 'Media' }: MediaOverlayProps) {
	const [scale, setScale] = React.useState(1)

	// Reset scale when overlay opens/closes
	React.useEffect(() => {
		if (open) {
			setScale(1)
		}
	}, [open])

	const handleZoomIn = () => {
		setScale(prev => prev * 2)
	}

	const handleZoomOut = () => {
		setScale(prev => Math.max(prev / 2, 0.25))
	}

	const isVideo = /\.(mp4|mov|webm|avi)$/i.test(src)

	return (
		<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<DialogPrimitive.Portal>
				{/* Scrim/Overlay Background */}
				<DialogPrimitive.Overlay
					className="fixed inset-0 z-50 bg-black/90 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
					onClick={() => onOpenChange(false)}
				/>
				
				{/* Content */}
				<DialogPrimitive.Content
					className="fixed inset-0 z-50 flex items-center justify-center p-4"
					onClick={() => onOpenChange(false)}
				>
					{/* Close button in top right */}
					<DialogPrimitive.Close
						className="absolute top-4 right-4 z-60 rounded-full bg-black/50 p-2 text-white transition-opacity hover:bg-black/70 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-transparent"
						onClick={() => onOpenChange(false)}
					>
						<XIcon className="h-6 w-6" />
						<span className="sr-only">Close</span>
					</DialogPrimitive.Close>

					{/* Zoom controls */}
					<div className="absolute top-4 left-4 z-60 flex gap-2">
						<button
							onClick={handleZoomOut}
							className="rounded-full bg-black/50 p-2 text-white transition-opacity hover:bg-black/70 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-transparent"
							disabled={scale <= 0.25}
						>
							<ZoomOutIcon className="h-5 w-5" />
							<span className="sr-only">Zoom out</span>
						</button>
						<button
							onClick={handleZoomIn}
							className="rounded-full bg-black/50 p-2 text-white transition-opacity hover:bg-black/70 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-transparent"
						>
							<ZoomInIcon className="h-5 w-5" />
							<span className="sr-only">Zoom in</span>
						</button>
					</div>

					{/* Media content */}
					<div 
						className="max-h-full max-w-full overflow-auto"
						style={{ 
							transform: `scale(${scale})`,
							transformOrigin: 'center center',
							transition: 'transform 0.2s ease-in-out'
						}}
						onClick={(e) => {
							// Prevent closing when clicking on the media itself
							e.stopPropagation()
						}}
					>
						{isVideo ? (
							<video
								src={src}
								controls
								className="max-h-[90vh] max-w-[90vw] object-contain"
								preload="metadata"
							/>
						) : (
							<img
								src={src}
								alt={alt}
								className="max-h-[90vh] max-w-[90vw] object-contain"
								loading="lazy"
							/>
						)}
					</div>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	)
}