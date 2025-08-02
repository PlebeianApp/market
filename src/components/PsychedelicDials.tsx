import React, { useState, useEffect } from 'react'
import { Slider } from '@/components/ui/slider'

interface PsychedelicDialsProps {
	className?: string
}

export function PsychedelicDials({ className = '' }: PsychedelicDialsProps) {
	const [colorIntensity, setColorIntensity] = useState([0])
	const [rotationSpeed, setRotationSpeed] = useState([0])
	const [pulseRate, setPulseRate] = useState([0])
	const [isActive, setIsActive] = useState(false)

	// Apply psychedelic effects when any dial is active
	useEffect(() => {
		const active = colorIntensity[0] > 0 || rotationSpeed[0] > 0 || pulseRate[0] > 0
		setIsActive(active)

		if (active) {
			// Add psychedelic CSS variables to document root
			document.documentElement.style.setProperty('--psychedelic-color-intensity', `${colorIntensity[0]}%`)
			document.documentElement.style.setProperty('--psychedelic-rotation-speed', `${rotationSpeed[0]}s`)
			document.documentElement.style.setProperty('--psychedelic-pulse-rate', `${pulseRate[0]}s`)
			document.documentElement.classList.add('psychedelic-mode')
		} else {
			document.documentElement.classList.remove('psychedelic-mode')
		}

		// Cleanup function
		return () => {
			if (!active) {
				document.documentElement.classList.remove('psychedelic-mode')
			}
		}
	}, [colorIntensity, rotationSpeed, pulseRate])

	const resetAll = () => {
		setColorIntensity([0])
		setRotationSpeed([0])
		setPulseRate([0])
	}

	return (
		<div className={`${className}`}>
			<div className="bg-white border border-black rounded-lg p-4 shadow-md">
				<div className="flex items-center justify-between mb-3">
					<h3 className="text-sm font-bold text-black">REALITY DIAL</h3>
					{isActive && (
						<button
							onClick={resetAll}
							className="text-xs px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
						>
							RESET
						</button>
					)}
				</div>
				
				<div className="space-y-4">
					{/* Color Intensity Dial */}
					<div className="space-y-2">
						<label className="text-xs font-medium text-gray-700 block">
							COLORS: {colorIntensity[0]}%
						</label>
						<Slider
							value={colorIntensity}
							onValueChange={setColorIntensity}
							max={100}
							step={1}
							className="w-full"
						/>
					</div>

					{/* Rotation Speed Dial */}
					<div className="space-y-2">
						<label className="text-xs font-medium text-gray-700 block">
							SPIN: {rotationSpeed[0] === 0 ? 'OFF' : `${10 - rotationSpeed[0]}x`}
						</label>
						<Slider
							value={rotationSpeed}
							onValueChange={setRotationSpeed}
							max={10}
							min={0}
							step={0.5}
							className="w-full"
						/>
					</div>

					{/* Pulse Rate Dial */}
					<div className="space-y-2">
						<label className="text-xs font-medium text-gray-700 block">
							PULSE: {pulseRate[0] === 0 ? 'OFF' : `${5 - pulseRate[0]}x`}
						</label>
						<Slider
							value={pulseRate}
							onValueChange={setPulseRate}
							max={5}
							min={0}
							step={0.1}
							className="w-full"
						/>
					</div>
				</div>

				{isActive && (
					<div className="mt-3 text-center">
						<span className="text-xs text-pink-600 font-bold animate-pulse">
							⚡ REALITY ALTERED ⚡
						</span>
					</div>
				)}
			</div>
		</div>
	)
}