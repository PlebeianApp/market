import { wotScoreQueryOptions } from '@/queries/profiles'
import { useQuery } from '@tanstack/react-query'
import { Shield, ShieldAlert, ShieldCheck, CircleQuestionMark } from 'lucide-react'

interface WotBadgeProps {
	pubkey: string
	className?: string
	showScore?: boolean
	threshold?: number // Optional threshold to determine "trusted" status
}

/**
 * Formats WOT score for display
 * - Returns score with appropriate precision
 */
function formatWotScore(score: number): string {
	return score.toFixed(1)
}

/**
 * Determines trust level based on score and threshold
 */
function getTrustLevel(score: number, threshold: number = 5): 'high' | 'medium' | 'low' {
	if (score >= threshold * 2) return 'high'
	if (score >= threshold) return 'medium'
	return 'low'
}

export function WotBadge({ pubkey, className = '', showScore = false, threshold = 5 }: WotBadgeProps) {
	const { data: wotScore, isLoading, isError } = useQuery(wotScoreQueryOptions(pubkey))

	if (isLoading) {
		return (
			<div className="flex items-center gap-2">
				<CircleQuestionMark className={`h-6 w-6 ${className} text-blue-500 animate-pulse`} />
				{showScore && <span className="text-sm text-gray-400">Loading...</span>}
			</div>
		)
	}

	if (isError || wotScore === null || wotScore === undefined) {
		return (
			<div className="flex items-center gap-2">
				<CircleQuestionMark className={`h-6 w-6 ${className} text-black`} />
				{showScore && <span className="text-sm text-gray-400">Unknown</span>}
			</div>
		)
	}

	const trustLevel = getTrustLevel(wotScore, threshold)

	if (trustLevel === 'high') {
		return (
			<div className="flex items-center gap-2">
				<ShieldCheck style={{ fill: 'var(--secondary)', color: 'var(--primary)' }} className={`w-6 h-6 ${className}`} />
				{showScore && <span className="text-sm text-green-500 font-semibold">{formatWotScore(wotScore)}</span>}
			</div>
		)
	}

	if (trustLevel === 'medium') {
		return (
			<div className="flex items-center gap-2">
				<Shield style={{ fill: 'orange', color: 'var(--primary)' }} className={`w-6 h-6 ${className}`} />
				{showScore && <span className="text-sm text-orange-500 font-semibold">{formatWotScore(wotScore)}</span>}
			</div>
		)
	}

	if (trustLevel === 'low') {
		return (
			<div className="flex items-center gap-2">
				<ShieldAlert style={{ fill: 'var(--destructive)', color: 'var(--primary)' }} className={`w-6 h-6 ${className}`} />
				{showScore && <span className="text-sm text-red-500 font-semibold">{formatWotScore(wotScore)}</span>}
			</div>
		)
	}

	return null
}
