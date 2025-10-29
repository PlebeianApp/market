import { useBugReports, useUserProfile, type BugReport } from '@/queries/bugReports'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDistanceToNow } from 'date-fns'
import { AlertCircle, FileText, MessageSquare } from 'lucide-react'
import { DashboardListItem } from '@/components/layout/DashboardListItem'
import { useState } from 'react'

function BugReportItem({ report, isExpanded, onToggleExpanded }: { report: BugReport; isExpanded: boolean; onToggleExpanded: () => void }) {
	const { data: userProfile, isLoading: isProfileLoading } = useUserProfile(report.pubkey)

	const timeAgo = formatDistanceToNow(new Date(report.createdAt * 1000), {
		addSuffix: true,
	})

	const triggerContent = (
		<div className="flex items-center gap-4">
			{isProfileLoading ? (
				<Skeleton className="h-10 w-10 rounded-full" />
			) : (
				<Avatar className="h-10 w-10">
					<AvatarImage src={userProfile?.picture} alt={userProfile?.name ?? report.pubkey.substring(0, 8)} />
					<AvatarFallback>{(userProfile?.name ?? report.pubkey.substring(0, 2)).toUpperCase()}</AvatarFallback>
				</Avatar>
			)}
			<div className="flex-1">
				<div className="flex items-center gap-2 text-sm">
					{isProfileLoading ? (
						<Skeleton className="h-4 w-24" />
					) : (
						<span className="font-semibold text-gray-800">{userProfile?.name ?? report.pubkey.substring(0, 12)}</span>
					)}
					<span className="text-gray-500">·</span>
					<span className="text-gray-500">{timeAgo}</span>
				</div>
			</div>
		</div>
	)

	return (
		<DashboardListItem
			isOpen={isExpanded}
			onOpenChange={onToggleExpanded}
			triggerContent={triggerContent}
			icon={<MessageSquare className="h-5 w-5 text-black" />}
		>
			<p className="mt-1 text-gray-700 whitespace-pre-wrap">{report.content}</p>
		</DashboardListItem>
	)
}

export function BugReportsList() {
	const { data: bugReports, isLoading, isError, error } = useBugReports(50)
	const [expandedReport, setExpandedReport] = useState<string | null>(null)

	const handleToggleExpanded = (reportId: string) => {
		setExpandedReport(expandedReport === reportId ? null : reportId)
	}

	if (isLoading) {
		return (
			<div className="space-y-4">
				{[...Array(5)].map((_, i) => (
					<div key={i} className="flex items-start gap-4 p-4">
						<Skeleton className="h-10 w-10 rounded-full" />
						<div className="flex-1 space-y-2">
							<Skeleton className="h-4 w-48" />
							<Skeleton className="h-4 w-full" />
							<Skeleton className="h-4 w-3/4" />
						</div>
					</div>
				))}
			</div>
		)
	}

	if (isError) {
		return (
			<div className="flex flex-col items-center justify-center h-full text-center p-6 bg-red-50 rounded-lg">
				<AlertCircle className="w-12 h-12 text-red-500 mb-4" />
				<h3 className="text-lg font-semibold text-red-800">Failed to load bug reports</h3>
				<p className="text-red-600 mt-2">{error instanceof Error ? error.message : 'An unknown error occurred'}</p>
			</div>
		)
	}

	if (!bugReports || bugReports.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center h-full text-center p-6 bg-gray-50 rounded-lg">
				<FileText className="w-12 h-12 text-gray-400 mb-4" />
				<h3 className="text-lg font-semibold text-gray-800">No bug reports found</h3>
				<p className="text-gray-600 mt-2">It looks like there are no bug reports yet. Be the first to submit one!</p>
			</div>
		)
	}

	return (
		<div className="space-y-2">
			{bugReports.map((report) => (
				<BugReportItem
					key={report.id}
					report={report}
					isExpanded={expandedReport === report.id}
					onToggleExpanded={() => handleToggleExpanded(report.id)}
				/>
			))}
		</div>
	)
}
