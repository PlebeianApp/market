import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { BugReportModal } from './BugReportModal'
import { cn } from '@/lib/utils'
import { useStore } from '@tanstack/react-store'
import { authStore } from '@/lib/stores/auth'

interface BugReportButtonProps {
	className?: string
}

export function BugReportButton({ className }: BugReportButtonProps) {
	const [isModalOpen, setIsModalOpen] = useState(false)
	const { isAuthenticated } = useStore(authStore)

	const handleBugReport = () => {
		setIsModalOpen(true)
	}

	// Only render if user is authenticated
	if (!isAuthenticated) {
		return null
	}

	return (
		<>
			<div className="fixed bottom-16 right-16 z-50 flex items-center gap-3">
				{/* Text label with pill background */}
				<div className="bg-white rounded-full px-3 py-1 shadow-lg">
					<span className="text-xs text-gray-700 font-medium whitespace-nowrap">Report a bug</span>
				</div>

				{/* Bug report button */}
				<Button
					variant="outline"
					size="icon"
					onClick={handleBugReport}
					className={cn(
						'h-12 w-12 rounded-full bg-black text-white hover:bg-black hover:text-secondary shadow-lg transition-colors cursor-help',
						className,
					)}
					aria-label="Report a bug"
				>
					<span className="i-bug w-6 h-6" />
				</Button>
			</div>
			<BugReportModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onReopen={() => setIsModalOpen(true)} />
		</>
	)
}
