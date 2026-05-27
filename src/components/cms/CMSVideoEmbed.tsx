import React, { useState } from 'react'

export interface VideoEmbedProps {
	videoUrl: string
	autoplay?: boolean
	loop?: boolean
	muted?: boolean
	posterImage?: string
	aspectRatio?: '16:9' | '4:3' | '1:1'
	title?: string
	showControls?: boolean
}

export const VideoEmbed: React.FC<VideoEmbedProps> = ({
	videoUrl,
	autoplay = false,
	loop = false,
	muted = false,
	posterImage,
	aspectRatio = '16:9',
	title = 'Video',
	showControls = true,
}) => {
	const [isPlaying, setIsPlaying] = useState(false)

	// Parse YouTube URL to extract video ID
	const getYoutubeId = (url: string): string | null => {
		const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/
		const match = url.match(regExp)
		return match && match[2].length === 11 ? match[2] : null
	}

	const youtubeId = getYoutubeId(videoUrl)
	const isYoutube = youtubeId !== null

	const aspectRatioClasses = {
		'16:9': 'aspect-video',
		'4:3': 'aspect-[4/3]',
		'1:1': 'aspect-square',
	}

	return (
		<div className={`relative w-full ${aspectRatioClasses[aspectRatio]} bg-gray-900 rounded-lg overflow-hidden shadow-lg`}>
			{!isPlaying && posterImage ? (
				<div className="absolute inset-0 cursor-pointer group" onClick={() => setIsPlaying(true)}>
					<img src={posterImage} alt={title} className="w-full h-full object-cover" />
					<div className="absolute inset-0 bg-black/40 group-hover:bg-black/30 transition-colors flex items-center justify-center">
						<div className="w-20 h-20 bg-orange-500 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform shadow-xl">
							<svg className="w-10 h-10 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
								<path d="M8 5v14l11-7z" />
							</svg>
						</div>
					</div>
				</div>
			) : (
				<div className="absolute inset-0">
					{isYoutube ? (
						<iframe
							src={`https://www.youtube.com/embed/${youtubeId}?autoplay=${autoplay ? 1 : 0}&loop=${loop ? 1 : 0}&mute=${muted ? 1 : 0}&controls=${showControls ? 1 : 0}`}
							title={title}
							className="w-full h-full"
							frameBorder="0"
							allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
							allowFullScreen
						/>
					) : (
						<video
							src={videoUrl}
							autoPlay={autoplay}
							loop={loop}
							muted={muted}
							controls={showControls}
							className="w-full h-full"
							poster={posterImage}
						/>
					)}
				</div>
			)}

			{/* Reset button if playing */}
			{isPlaying && !isYoutube && (
				<button
					onClick={() => setIsPlaying(false)}
					className="absolute top-4 right-4 p-2 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors z-10"
					aria-label="Stop video"
				>
					<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			)}
		</div>
	)
}
