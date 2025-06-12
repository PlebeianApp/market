import { cn } from '@/lib/utils'
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel'
import { ImageOff } from 'lucide-react'
import { useState, useEffect } from 'react'
import type { CarouselApi } from '@/components/ui/carousel'

interface ProductImage {
	url: string
	dimensions?: string
	order?: number
}

interface ImageCarouselProps {
	images: ProductImage[]
	title: string
	className?: string
	onImageChange?: (index: number) => void
}

export function ImageCarousel({ images, title, className, onImageChange }: ImageCarouselProps) {
	const [currentIndex, setCurrentIndex] = useState(0)
	const [api, setApi] = useState<CarouselApi>()

	useEffect(() => {
		if (!api) return

		api.on('select', () => {
			const newIndex = api.selectedScrollSnap()
			setCurrentIndex(newIndex)
			onImageChange?.(newIndex)
		})
	}, [api, onImageChange])

	// Call onImageChange when component mounts or images change
	useEffect(() => {
		if (images.length > 0) {
			onImageChange?.(0)
		}
	}, [images, onImageChange])

	if (!images || images.length === 0) {
		return (
			<div className={cn('relative h-full w-full bg-zinc-900', className)}>
				<div className="flex h-full w-full items-center justify-center">
					<ImageOff className="h-12 w-12 text-zinc-500" />
				</div>
			</div>
		)
	}

	return (
		<div className="h-full flex flex-col lg:flex-row gap-4">
			{/* Main Carousel */}
			<Carousel setApi={setApi} className="w-full xl:aspect-square lg:order-2">
				<CarouselContent>
					{images.map((image, index) => (
						<CarouselItem key={index} className="flex items-center justify-center relative">
							{index === currentIndex && <div className="absolute inset-0 bg-dots-image-overlay pointer-events-none" />}
							<img src={image.url} alt={`${title} - Image ${index + 1}`} className="max-h-[45vh] max-w-full relative z-10" />
						</CarouselItem>
					))}
				</CarouselContent>
			</Carousel>

			{/* Preview Images */}
			<div className="flex flex-row overflow-x-auto gap-2 justify-center lg:flex-col lg:order-1 p-4">
				{images.map((image, index) => (
					<button
						key={index}
						className={cn(
							'relative w-16 p-1 transition-all flex-shrink-0',
							index === currentIndex ? 'ring-2 ring-secondary' : 'hover:ring-1 hover:ring-primary/50',
						)}
						onClick={() => {
							api?.scrollTo(index)
							setCurrentIndex(index)
							onImageChange?.(index)
						}}
					>
						<div className="aspect-square w-full overflow-hidden relative bg-black border border-gray-800">
							<img className="h-full w-full object-cover" src={image.url} alt={`${title} thumbnail ${index + 1}`} />
						</div>
						{index === currentIndex && <div className="absolute bottom-1 right-1 w-2 h-2 bg-primary rounded-full" />}
					</button>
				))}
			</div>
		</div>
	)
}
