import React, { useState, useEffect } from 'react'

interface Slide {
	image: string
	title: string
	subtitle?: string
	link?: string
	ctaText?: string
}

export interface HeroCarouselProps {
	slides: Slide[]
	autoplay?: boolean
	rotationSpeed?: number
	showDots?: boolean
	showArrows?: boolean
	transitionEffect?: 'fade' | 'slide'
}

export const HeroCarousel: React.FC<HeroCarouselProps> = ({
	slides,
	autoplay = true,
	rotationSpeed = 5000,
	showDots = true,
	showArrows = true,
	transitionEffect = 'fade',
}) => {
	const [currentIndex, setCurrentIndex] = useState(0)

	const nextSlide = () => {
		setCurrentIndex((prev) => (prev + 1) % slides.length)
	}

	const prevSlide = () => {
		setCurrentIndex((prev) => (prev - 1 + slides.length) % slides.length)
	}

	useEffect(() => {
		if (!autoplay) return
		const interval = setInterval(nextSlide, rotationSpeed)
		return () => clearInterval(interval)
	}, [autoplay, rotationSpeed])

	const transitionClass =
		transitionEffect === 'fade'
			? 'opacity-0 transition-opacity duration-700 ease-in-out'
			: 'translate-x-full transition-transform duration-700 ease-in-out absolute inset-0'

	const activeTransitionClass = transitionEffect === 'fade' ? 'opacity-100' : 'translate-x-0 relative'

	return (
		<div className="relative w-full h-[600px] md:h-[700px] overflow-hidden bg-gray-900">
			{slides.map((slide, index) => (
				<div key={index} className={`w-full h-full absolute inset-0 ${index === currentIndex ? activeTransitionClass : transitionClass}`}>
					<img src={slide.image} alt={slide.title} className="w-full h-full object-cover" />
					<div className="absolute inset-0 bg-black/40" />

					<div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
						<h2 className="text-4xl md:text-6xl font-bold text-white mb-4 drop-shadow-lg">{slide.title}</h2>
						{slide.subtitle && <p className="text-xl md:text-2xl text-gray-200 mb-8 max-w-3xl drop-shadow-md">{slide.subtitle}</p>}
						{slide.ctaText && slide.link && (
							<a
								href={slide.link}
								className="px-8 py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-md transition-colors"
							>
								{slide.ctaText}
							</a>
						)}
					</div>
				</div>
			))}

			{/* Arrows */}
			{showArrows && (
				<>
					<button
						onClick={prevSlide}
						className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors z-20"
						aria-label="Previous slide"
					>
						<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
						</svg>
					</button>
					<button
						onClick={nextSlide}
						className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors z-20"
						aria-label="Next slide"
					>
						<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
						</svg>
					</button>
				</>
			)}

			{/* Dots */}
			{showDots && (
				<div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex space-x-2 z-20">
					{slides.map((_, index) => (
						<button
							key={index}
							onClick={() => setCurrentIndex(index)}
							className={`w-3 h-3 rounded-full transition-all ${
								index === currentIndex ? 'bg-white scale-125' : 'bg-white/50 hover:bg-white/80'
							}`}
							aria-label={`Go to slide ${index + 1}`}
						/>
					))}
				</div>
			)}
		</div>
	)
}
