import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

const COLORS = ['#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#a855f7']
const GRAVITY = 0.18
const PARTICLES_PER_BURST = 80

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
	createdAt: number
}

/** Repeating viewport confetti launched from the bottom edge. No-ops under prefers-reduced-motion. */
export function ConfettiBurst({ durationMs = 2600, intervalMs = 3000 }: { durationMs?: number; intervalMs?: number }) {
	const canvasRef = useRef<HTMLCanvasElement>(null)

	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas) return
		if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

		const ctx = canvas.getContext('2d')
		if (!ctx) return

		let width = window.innerWidth
		let height = window.innerHeight
		let particles: Particle[] = []
		let animationFrame: number

		const resizeCanvas = () => {
			const dpr = window.devicePixelRatio || 1
			width = window.innerWidth
			height = window.innerHeight
			canvas.width = width * dpr
			canvas.height = height * dpr
			canvas.style.width = `${width}px`
			canvas.style.height = `${height}px`
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
		}

		const launchBurst = () => {
			const createdAt = performance.now()
			particles.push(
				...Array.from({ length: PARTICLES_PER_BURST }, () => ({
					x: width / 2 + (Math.random() - 0.5) * Math.min(width * 0.7, 700),
					y: height + 10,
					vx: (Math.random() - 0.5) * 8,
					vy: Math.random() * -10 - 12,
					rotation: Math.random() * 360,
					rotationSpeed: (Math.random() - 0.5) * 12,
					size: Math.random() * 6 + 4,
					color: COLORS[Math.floor(Math.random() * COLORS.length)],
					shape: Math.random() > 0.5 ? ('rect' as const) : ('circle' as const),
					createdAt,
				})),
			)
		}

		resizeCanvas()
		window.addEventListener('resize', resizeCanvas)
		launchBurst()
		const burstInterval = window.setInterval(launchBurst, intervalMs)

		const tick = (now: number) => {
			ctx.clearRect(0, 0, width, height)
			particles = particles.filter((particle) => now - particle.createdAt < durationMs)

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

			animationFrame = requestAnimationFrame(tick)
		}

		animationFrame = requestAnimationFrame(tick)
		return () => {
			window.removeEventListener('resize', resizeCanvas)
			window.clearInterval(burstInterval)
			cancelAnimationFrame(animationFrame)
		}
	}, [durationMs, intervalMs])

	if (typeof document === 'undefined') return null

	return createPortal(<canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-[60]" aria-hidden="true" />, document.body)
}
