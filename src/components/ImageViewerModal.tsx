import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { X, ZoomIn, ZoomOut, RotateCw, Download, ChevronLeft, ChevronRight } from 'lucide-react'
import { useState, useEffect } from 'react'

interface ImageViewerModalProps {
	isOpen: boolean
	onClose: () => void
	images: { url: string; title: string }[]
	currentIndex: number
	onIndexChange: (newIndex: number) => void
}

export function ImageViewerModal({ isOpen, onClose, images, currentIndex, onIndexChange }: ImageViewerModalProps) {
	const [zoom, setZoom] = useState(100)
	const [rotation, setRotation] = useState(0)

	// Reset zoom and rotation when modal opens/closes or image changes
	useEffect(() => {
		if (isOpen) {
			setZoom(100)
			setRotation(0)
		}
	}, [isOpen, currentIndex])

	const handleZoomIn = () => {
		setZoom((prev) => Math.min(prev + 25, 300))
	}

	const handleZoomOut = () => {
		setZoom((prev) => Math.max(prev - 25, 50))
	}

	const handleRotate = () => {
		setRotation((prev) => (prev + 90) % 360)
	}

	const handleDownload = async () => {
		try {
			const response = await fetch(images[currentIndex]?.url || '')
			const blob = await response.blob()
			const url = window.URL.createObjectURL(blob)
			const link = document.createElement('a')
			link.href = url
			link.download = `${images[currentIndex]?.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.jpg`
			document.body.appendChild(link)
			link.click()
			document.body.removeChild(link)
			window.URL.revokeObjectURL(url)
		} catch (error) {
			console.error('Failed to download image:', error)
		}
	}

	const handlePrev = () => {
		onIndexChange((currentIndex - 1 + images.length) % images.length)
	}

	const handleNext = () => {
		onIndexChange((currentIndex + 1) % images.length)
	}

	// Don't render if no images
	if (!images.length || !images[currentIndex]) {
		return null
	}

	return (
		<Dialog open={isOpen} onOpenChange={onClose}>
			<DialogTitle>{images[currentIndex]?.title}</DialogTitle>
			<DialogContent className="!max-w-[95vw] sm:!max-w-[95vw] w-[95vw] h-[95vh] p-0 bg-black/95 border-none">
				{/* Toolbar */}
				<div className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between p-4 bg-gradient-to-b from-black/80 to-transparent">
					<div className="flex items-center gap-2">
						<Button
							variant="ghost"
							size="icon"
							onClick={handleZoomOut}
							disabled={zoom <= 50}
							className="text-white hover:bg-white/20"
							aria-label="Zoom out"
						>
							<ZoomOut className="h-5 w-5" />
						</Button>
						<span className="text-white text-sm font-medium min-w-[4rem] text-center">{zoom}%</span>
						<Button
							variant="ghost"
							size="icon"
							onClick={handleZoomIn}
							disabled={zoom >= 300}
							className="text-white hover:bg-white/20"
							aria-label="Zoom in"
						>
							<ZoomIn className="h-5 w-5" />
						</Button>
						<Button variant="ghost" size="icon" onClick={handleRotate} className="text-white hover:bg-white/20" aria-label="Rotate">
							<RotateCw className="h-5 w-5" />
						</Button>
						<Button variant="ghost" size="icon" onClick={handleDownload} className="text-white hover:bg-white/20" aria-label="Download">
							<Download className="h-5 w-5" />
						</Button>
					</div>
					<div className="flex items-center gap-4">
						{/* Image counter */}
						{images.length > 1 && (
							<span className="text-white text-sm">
								{currentIndex + 1} of {images.length}
							</span>
						)}
						<Button variant="ghost" size="icon" onClick={onClose} className="text-white hover:bg-white/20" aria-label="Close">
							<X className="h-5 w-5" />
						</Button>
					</div>
				</div>

				{/* Image Container */}
				<div className="w-full h-full flex items-center justify-center overflow-auto relative">
					{/* Left navigation button */}
					{images.length > 1 && (
						<Button
							variant="ghost"
							size="icon"
							onClick={handlePrev}
							className="hidden sm:inline-flex absolute left-4 top-1/2 -translate-y-1/2 z-40 bg-black/40 hover:bg-black/60 text-white"
							aria-label="Previous image"
							style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}
						>
							<ChevronLeft className="h-8 w-8" />
						</Button>
					)}

					{/* Right navigation button */}
					{images.length > 1 && (
						<Button
							variant="ghost"
							size="icon"
							onClick={handleNext}
							className="hidden sm:inline-flex absolute right-4 top-1/2 -translate-y-1/2 z-40 bg-black/40 hover:bg-black/60 text-white"
							aria-label="Next image"
							style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}
						>
							<ChevronRight className="h-8 w-8" />
						</Button>
					)}

					{/* Bottom navigation for mobile */}
					{images.length > 1 && (
						<div className="sm:hidden absolute bottom-0 left-0 right-0 z-40 flex items-center justify-center gap-6 px-6 py-4 bg-gradient-to-t from-black/80 to-transparent">
							<Button
								variant="ghost"
								size="icon"
								onClick={handlePrev}
								className="bg-black/40 hover:bg-black/60 text-white"
								aria-label="Previous image"
								style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}
							>
								<ChevronLeft className="h-8 w-8" />
							</Button>

							<Button
								variant="ghost"
								size="icon"
								onClick={handleNext}
								className="bg-black/40 hover:bg-black/60 text-white"
								aria-label="Next image"
								style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}
							>
								<ChevronRight className="h-8 w-8" />
							</Button>
						</div>
					)}

					<div className="relative flex items-center justify-center w-full h-full p-16">
						<img
							src={images[currentIndex]?.url}
							alt={images[currentIndex]?.title}
							className="max-w-full max-h-full object-contain transition-transform duration-200"
							style={{
								transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
							}}
						/>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	)
}
