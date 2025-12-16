import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="outline"
						size="icon"
						onClick={handleBugReport}
						className={cn(
							'fixed bottom-16 right-16 z-50 h-10 w-10 px-4 py-2 rounded-full bg-black text-white hover:bg-black hover:text-secondary shadow-lg transition-colors',
							className,
						)}
						aria-label="Report a bug"
					>
						<span className="i-bug w-6 h-6 px-2 py-0 hover:bg-black hover:text-secondary" />
					</Button>
				</TooltipTrigger>
				<TooltipContent>
					<p>Report a bug</p>
				</TooltipContent>
			</Tooltip>
			<BugReportModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onReopen={() => setIsModalOpen(true)} />
		</>
	)
}
