import React from 'react'

interface ProgressBarProps extends React.HTMLAttributes<HTMLDivElement> {
	/** The percentage of the bar to fill (0-100). This will be held steady. */
	progress: number
	/** Duration of the initial fill animation (only used if progress is 0 initially) */
	fillDuration?: number
	/** Color of the bar and border */
	color?: string
	/** Height of the bar in pixels */
	height?: number
	/** Max width of the bar in pixels */
	maxWidth?: number
}

const ProgressBar: React.FC<ProgressBarProps> = ({
	progress = 0,
	fillDuration = 1,
	color = '#05e35e',
	height = 20,
	maxWidth = 500,
	className, // Extract className explicitly
	style, // Extract style explicitly to merge
	...props
}) => {
	const progressPct = Math.min(Math.max(progress * 100, 0), 100) // Clamp between 0 and 100

	// Constants for the stripe pattern
	const stripeRepeat = 20 // Total width of one pattern unit (line + gap)
	const stripeLineWidth = 2 // Width of the white line
	const animationSpeed = 1 // Seconds for one full loop of stripes

	// Inject static keyframes ONCE.
	// We do NOT include progressPct here to avoid re-calculating the animation frame.
	React.useEffect(() => {
		const styleId = 'progress-bar-static-keyframes'
		if (!document.getElementById(styleId)) {
			const style = document.createElement('style')
			style.id = styleId
			style.innerHTML = `
				@keyframes fill-once {
					from { width: 0%; }
					to { width: 100%; } /* We will override the 'to' width via inline style if needed, but here we use a trick */
				}
				@keyframes move-stripes {
					0% { background-position: 0 0; }
					100% { background-position: -${stripeRepeat}px 0; } /* Move exactly one pattern width */
				}
			`
			document.head.appendChild(style)
		}
	}, []) // Empty dependency array: runs only once on mount

	const containerStyle: React.CSSProperties = {
		padding: '2px',
		width: '100%',
		maxWidth: `${maxWidth}px`,
		border: `3px solid ${color}`,
		height: `${height}px`,
		borderRadius: '4px',
		overflow: 'hidden',
		position: 'relative',
	}

	// The bar style
	const barStyle: React.CSSProperties = {
		height: '100%',
		width: `${progressPct}%`, // Static width based on prop

		// 1. Base Color (Green)
		backgroundColor: color,

		// 2. The Gradient (White Lines on Green)
		// transparent (gap) -> white (line) -> transparent (gap)
		backgroundImage: `repeating-linear-gradient(
			45deg, 
			white, 
			white ${stripeLineWidth}px, 
			transparent ${stripeLineWidth}px, 
			transparent ${stripeRepeat}px
		)`,

		// 3. Ensure background size matches the pattern exactly
		backgroundSize: `${stripeRepeat}px ${height}px`,

		// 4. Animations

		animation: `move-stripes ${animationSpeed}s linear infinite`,

		transition: `width ${fillDuration}s cubic-bezier(0.4, 0, 0.2, 1)`,

		...style,
	}

	return (
		<div style={containerStyle} className={className} {...props}>
			<div style={barStyle} />
		</div>
	)
}

export default ProgressBar
