import { useEffect, useRef } from 'react'

const COLORS = ['#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#a855f7']
const GRAVITY = 0.25

interface Particle {
	x: number
	y: number
	vx: number
	vy: number
	rotation: number
	rotationSpeed: number
	size: number
	color: string
	shape: 'rect' | 'circle'
}

/** Fire-and-forget confetti burst that fills its positioned parent. No-ops under prefers-reduced-motion. */
export function ConfettiBurst({ durationMs = 2600 }: { durationMs?: number }) {
	const canvasRef = useRef<HTMLCanvasElement>(null)

	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas) return
		if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

		const ctx = canvas.getContext('2d')
		if (!ctx) return

		const dpr = window.devicePixelRatio || 1
		const width = canvas.clientWidth
		const height = canvas.clientHeight
		canvas.width = width * dpr
		canvas.height = height * dpr
		ctx.scale(dpr, dpr)

		const particles: Particle[] = Array.from({ length: 80 }, () => ({
			x: width / 2 + (Math.random() - 0.5) * width * 0.4,
			y: height * 0.2,
			vx: (Math.random() - 0.5) * 6,
			vy: Math.random() * -6 - 2,
			rotation: Math.random() * 360,
			rotationSpeed: (Math.random() - 0.5) * 12,
			size: Math.random() * 6 + 4,
			color: COLORS[Math.floor(Math.random() * COLORS.length)],
			shape: Math.random() > 0.5 ? 'rect' : 'circle',
		}))

		const start = performance.now()
		let animationFrame: number

		const tick = (now: number) => {
			ctx.clearRect(0, 0, width, height)

			for (const p of particles) {
				p.vy += GRAVITY
				p.x += p.vx
				p.y += p.vy
				p.rotation += p.rotationSpeed

				ctx.save()
				ctx.translate(p.x, p.y)
				ctx.rotate((p.rotation * Math.PI) / 180)
				ctx.fillStyle = p.color
				if (p.shape === 'rect') {
					ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
				} else {
					ctx.beginPath()
					ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2)
					ctx.fill()
				}
				ctx.restore()
			}

			if (now - start < durationMs) {
				animationFrame = requestAnimationFrame(tick)
			} else {
				ctx.clearRect(0, 0, width, height)
			}
		}

		animationFrame = requestAnimationFrame(tick)
		return () => cancelAnimationFrame(animationFrame)
	}, [durationMs])

	return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-10 h-full w-full" aria-hidden="true" />
}
