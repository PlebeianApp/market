import React, { useEffect, useMemo } from 'react'
import { cn } from '@/lib/utils'

interface ProgressBarProps extends React.HTMLAttributes<HTMLDivElement> {
	/** The percentage of the bar to fill (0-100). This will be held steady. */
	progress: number
	/** Duration of the initial fill animation (only used if progress is 0 initially) */
	fillDuration?: number
	/** Color of the bar, border, and glow */
	color?: string
	/** Color filling the back of the bar */
	backgroundColor?: string
	/** Height of the bar in pixels */
	height?: number
	/** Enable the pulsing glow effect */
	glow?: boolean
	/** Width of the white stripe line in pixels (default: 2) */
	stripeWidth?: number
	/** Gap between stripes in pixels (default: 8, total repeat = width + gap) */
	stripeGap?: number
	/** Opacity of the white stripes (0-1, default: 0.3) */
	stripeOpacity?: number
	/** Speed of the stripe animation in seconds (default: 1) */
	stripeSpeed?: number
	/** Angle of the stripes in degrees (default: 45) */
	stripeAngle?: number
	/** Height of the repeating bar pattern */
	stripeHeight?: number
	/** Text to be overlaid on top of the progress bar */
	label?: string
	/** Changes the light/dark aspect of the text */
	textOnDark?: boolean
}

const ProgressBar: React.FC<ProgressBarProps> = ({
	progress = 0,
	fillDuration = 1,
	color = '#05e35e',
	backgroundColor = '#444444',
	textOnDark = true,
	height = 32,
	glow = false,
	stripeWidth = 8,
	stripeGap = 4,
	stripeOpacity = 0.3,
	stripeSpeed = 1,
	stripeAngle = 45,
	stripeHeight = 34,
	label,
	className,
	style,
	...props
}) => {
	const progressPct = Math.min(Math.max(progress * 100, 0), 100)
	const stripeRepeat = stripeWidth + stripeGap

	const instanceId = useMemo(() => `pb-${Math.random().toString(36).slice(2, 9)}`, [])

	// Helper to convert hex to RGB for box-shadow
	const hexToRgb = (hex: string) => {
		const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
		return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '0, 0, 0'
	}

	// Inject UNIQUE keyframes for this instance
	useEffect(() => {
		const styleId = `progress-bar-${instanceId}`
		const style = document.createElement('style')
		style.id = styleId
		style.innerHTML = `
			@keyframes move-stripes-${instanceId} {
				0% { background-position: 0 0px; }
				100% { background-position: ${stripeRepeat}px 0px; }
			}
			@keyframes pulse-glow-${instanceId} {
				0%, 100% { box-shadow: 0 0 0 0 rgba(${hexToRgb(color)}, 0); }
				50% { box-shadow: 0 0 15px 5px rgba(${hexToRgb(color)}, 0.6); }
			}
		`
		document.head.appendChild(style)

		// Cleanup on unmount
		return () => {
			const existing = document.getElementById(styleId)
			if (existing) existing.remove()
		}
	}, [color, stripeRepeat, instanceId])

	const containerStyle: React.CSSProperties = {
		padding: '2px',
		width: '100%',
		border: `3px solid ${color}`,
		height: `${height}px`,
		borderRadius: '9999px',
		overflow: 'hidden',
		position: 'relative',
		backgroundColor: backgroundColor,
		// Apply glow animation if enabled
		animation: glow ? `pulse-glow-${instanceId} 2s ease-in-out infinite` : 'none',
	}

	const barStyle: React.CSSProperties = {
		height: '100%',
		width: `${progressPct}%`,
		minWidth: '1.5rem',
		backgroundColor: color,
		borderRadius: '9999px',

		// Dynamic Gradient
		backgroundImage: `repeating-linear-gradient(
			${stripeAngle}deg, 
			rgba(255, 255, 255, ${stripeOpacity}), 
			rgba(255, 255, 255, ${stripeOpacity}) ${stripeWidth}px, 
			transparent ${stripeWidth}px, 
			transparent ${stripeRepeat}px
		)`,

		backgroundSize: `${stripeRepeat}px ${stripeHeight}px`,

		// Animations
		animation: `move-stripes-${instanceId} ${stripeSpeed}s linear infinite`,
		transition: `width ${fillDuration}s cubic-bezier(0.4, 0, 0.2, 1)`,

		...style,
	}

	return (
		<div className="relative rounded-md w-full">
			{/** Progress Bar Element */}
			<div style={containerStyle} className={cn(className)} {...props}>
				{/** Progress Bar Fill */}
				<div style={barStyle} />
			</div>
			{/** Text Overlay */}
			{label && (
				<div className="absolute inset-0 flex items-center justify-center px-2 pointer-events-none">
					<span
						className={cn(
							'font-semibold max-w-full truncate text-sm whitespace-nowrap overflow-visible',
							textOnDark && `text-shadow-[0_0px_6px_rgb(0_0_0/1.0)]`,
							textOnDark ? `text-white` : 'text-tertiary-black',
						)}
					>
						{label}
					</span>
				</div>
			)}
		</div>
	)
}

export default ProgressBar
