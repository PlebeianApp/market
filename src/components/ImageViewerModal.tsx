import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { X, ZoomIn, ZoomOut, RotateCw, Download } from 'lucide-react'
import { useState, useEffect } from 'react'

interface ImageViewerModalProps {
	isOpen: boolean
	onClose: () => void
	imageUrl: string
	imageTitle: string
}

export function ImageViewerModal({ isOpen, onClose, imageUrl, imageTitle }: ImageViewerModalProps) {
	const [zoom, setZoom] = useState(100)
	const [rotation, setRotation] = useState(0)

	// Reset zoom and rotation when modal opens/closes or image changes
	useEffect(() => {
		if (isOpen) {
			setZoom(100)
			setRotation(0)
		}
	}, [isOpen, imageUrl])

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
			const response = await fetch(imageUrl)
			const blob = await response.blob()
			const url = window.URL.createObjectURL(blob)
			const link = document.createElement('a')
			link.href = url
			link.download = `${imageTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.jpg`
			document.body.appendChild(link)
			link.click()
			document.body.removeChild(link)
			window.URL.revokeObjectURL(url)
		} catch (error) {
			console.error('Failed to download image:', error)
		}
	}

	return (
		<Dialog open={isOpen} onOpenChange={onClose}>
			<DialogTitle>{imageTitle}</DialogTitle>
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
					<Button variant="ghost" size="icon" onClick={onClose} className="text-white hover:bg-white/20" aria-label="Close">
						<X className="h-5 w-5" />
					</Button>
				</div>

				{/* Image Container */}
				<div className="w-full h-full flex items-center justify-center overflow-auto">
					<div className="relative flex items-center justify-center w-full h-full p-16">
						<img
							src={imageUrl}
							alt={imageTitle}
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
