import type { ReactNode } from 'react'
import { Pattern } from './pattern'

interface HeroProps {
	children: ReactNode
}

export function Hero({ children }: HeroProps) {
	return (
		<div className="flex flex-col relative w-full text-white overflow-hidden" style={{ backgroundColor: 'black' }}>
			<div
				className="absolute inset-x-0 -bottom-18 h-full blur-2xl"
				style={{
					background: 'radial-gradient(ellipse at bottom, var(--secondary) 20%, transparent 70%)',
					opacity: '0.3',
				}}
			></div>

			<Pattern />

			<div className="relative py-20 text-center">{children}</div>
		</div>
	)
}
