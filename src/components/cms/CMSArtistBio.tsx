import React, { type JSX } from 'react'

interface SocialLink {
	platform: 'instagram' | 'twitter' | 'nostr' | 'telegram' | 'website'
	url: string
}

export interface ArtistBioProps {
	portraitImage: string
	name: string
	shortBio: string
	fullBioLink?: string
	socialLinks?: SocialLink[]
	alignment?: 'left' | 'center'
}

export const ArtistBio: React.FC<ArtistBioProps> = ({
	portraitImage,
	name,
	shortBio,
	fullBioLink,
	socialLinks = [],
	alignment = 'left',
}) => {
	const socialIcons: Record<string, JSX.Element> = {
		instagram: (
			<path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
		),
		twitter: (
			<path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z" />
		),
		nostr: (
			<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.09-.83 3.98-2.19 5.39z" />
		),
		telegram: (
			<path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.75-.33 1.42.2 1.17 1.21l-2.71 12.73c-.2.92-1.11 1.13-1.88.68l-5.39-3.97z" />
		),
		website: (
			<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.09-.83 3.98-2.19 5.39z" />
		),
	}

	const alignmentClasses = {
		left: 'items-start text-left',
		center: 'items-center text-center',
	}

	return (
		<div className={`flex flex-col md:flex-row gap-8 md:gap-12 py-16 px-6 max-w-4xl mx-auto ${alignmentClasses[alignment]}`}>
			{/* Portrait Image */}
			<div className="flex-shrink-0">
				<div className="relative w-48 h-48 md:w-64 md:h-64 rounded-full overflow-hidden border-4 border-orange-500 shadow-xl">
					<img src={portraitImage} alt={name} className="w-full h-full object-cover" />
				</div>
			</div>

			{/* Bio Content */}
			<div className="flex-1 flex flex-col justify-center">
				<h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">{name}</h2>

				<div className="text-gray-600 mb-6 leading-relaxed prose max-w-none">
					<p>{shortBio}</p>
				</div>

				{/* Social Links */}
				{socialLinks.length > 0 && (
					<div className="flex flex-wrap gap-4 mb-6">
						{socialLinks.map((link, index) => (
							<a
								key={index}
								href={link.url}
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors"
							>
								<svg className="w-5 h-5 text-gray-700" fill="currentColor" viewBox="0 0 24 24">
									{socialIcons[link.platform]}
								</svg>
								<span className="text-sm font-medium text-gray-700 capitalize">{link.platform}</span>
							</a>
						))}
					</div>
				)}

				{/* Full Bio Link */}
				{fullBioLink && (
					<a
						href={fullBioLink}
						className="inline-flex items-center text-orange-600 font-semibold hover:text-orange-700 transition-colors group self-start md:self-auto"
					>
						Read Full Bio
						<svg
							className="w-4 h-4 ml-2 transform group-hover:translate-x-1 transition-transform"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
						</svg>
					</a>
				)}
			</div>
		</div>
	)
}
