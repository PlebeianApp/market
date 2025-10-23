import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useUserProfile } from '@/queries/bugReports'
import { useNavigate } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import type { BugReport } from '@/queries/bugReports'

interface BugReportItemProps {
	report: BugReport
	className?: string
}

export function BugReportItem({ report, className }: BugReportItemProps) {
	const navigate = useNavigate()
	const { data: profile, isLoading: isLoadingProfile } = useUserProfile(report.pubkey)

	const handleProfileClick = () => {
		navigate({ to: '/profile/$profileId', params: { profileId: report.pubkey } })
	}

	const displayName = profile?.name || profile?.displayName || report.pubkey.slice(0, 8) + '...'
	const nameInitial = displayName.charAt(0).toUpperCase()

	const formatDate = (timestamp: number) => {
		return new Date(timestamp * 1000).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		})
	}

	return (
		<div className={cn('border border-gray-200 rounded-lg p-4 space-y-3', className)}>
			{/* User info header */}
			<div className="flex items-center justify-between">
				<Button variant="ghost" onClick={handleProfileClick} className="flex items-center gap-2 p-0 h-auto hover:bg-gray-50">
					<Avatar className="h-8 w-8">
						<AvatarImage src={profile?.picture} />
						<AvatarFallback className="text-xs">{nameInitial}</AvatarFallback>
					</Avatar>
					<div className="flex flex-col items-start">
						<span className="text-sm font-medium text-gray-900">{displayName}</span>
						<span className="text-xs text-gray-500">{report.pubkey.slice(0, 8)}...</span>
					</div>
				</Button>
				<span className="text-xs text-gray-500">{formatDate(report.createdAt)}</span>
			</div>

			{/* Report content */}
			<div className="text-sm text-gray-800 whitespace-pre-wrap break-words">{report.content}</div>
		</div>
	)
}
