import { Card } from '@/components/ui/card'
import { pubkeyForms, type V4VRecipientRequirement } from '@/lib/v4v/share'
import { UserCard } from '../UserCard'

interface RecipientPreviewProps {
	npub: string
	/** The allocation, already formatted by the call site's unit. */
	allocationLabel: string
	/** What this recipient must satisfy; the component renders the outcome, not the rule. */
	requirement: V4VRecipientRequirement
}

/**
 * The preview of a recipient about to be added. Whether it is acceptable is a
 * property of the call site's `requirement` (zap-capable for sales, a payout
 * capability for auctions, nothing at all) — this component only renders the
 * three states that requirement can be in.
 */
export function RecipientPreview({ npub, allocationLabel, requirement }: RecipientPreviewProps) {
	if (!npub) return null

	const { pubkey } = pubkeyForms(npub)

	// An npub that does not decode is not a recipient at all.
	if (npub.startsWith('npub') && pubkey === npub) {
		return (
			<Card className="p-3 border-dashed border-orange-300 bg-orange-50 mt-2">
				<div className="text-sm text-orange-700">Invalid npub format</div>
			</Card>
		)
	}

	const checking = requirement.required && requirement.checking
	const failed = requirement.required && requirement.satisfied === false

	if (checking) {
		return (
			<Card className="p-3 border-dashed mt-2">
				<div className="flex items-center gap-2">
					<div className="h-6 w-6 rounded-full bg-gray-200 animate-pulse"></div>
					<div className="flex-1 h-4 bg-gray-200 animate-pulse rounded"></div>
					<div className="text-sm text-gray-500">{requirement.checkingMessage}</div>
				</div>
			</Card>
		)
	}

	return (
		<Card className={`p-3 border-dashed ${failed ? 'border-red-300 bg-red-50' : 'border-green-300 bg-green-50'} mt-2`}>
			<div className="flex items-center gap-2">
				<UserCard pubkey={pubkey} size="xs" />
				<div className="flex-grow"></div>
				<div className="font-semibold">{allocationLabel}</div>
				{failed && <div className="text-sm text-red-600">{requirement.unsatisfiedMessage}</div>}
			</div>
		</Card>
	)
}
