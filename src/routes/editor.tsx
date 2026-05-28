import { Puck } from '@puckeditor/core'
import type { Config, Data } from '@puckeditor/core'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import '@puckeditor/core/puck.css'
import { useEffect, useMemo, useState } from 'react'
import { saveDraft, loadDraft, clearDraft } from '@/lib/cms/storage'
import { toast } from 'sonner'
import { getCMSConfig } from '@/config/cms'
import { useAuth } from '@/lib/stores/auth'

// Initial empty data
const INITIAL_DATA: Data = {
	root: {},
	content: [],
}

export const Route = createFileRoute('/editor')({
	component: EditorRouteComponent,
})

function EditorRouteComponent() {
	const [data, setData] = useState<Data>(INITIAL_DATA)
	const [isLoading, setIsLoading] = useState(true)
	const { user } = useAuth()

	const config = useMemo(() => {
		return getCMSConfig(user ?? undefined)
	}, [user?.pubkey])

	// 1. Load draft on mount
	useEffect(() => {
		const saved = loadDraft()
		if (saved) {
			setData(saved)
		}
		setIsLoading(false)
	}, [])

	// 2. Handle Publish (Save)
	const handlePublish = (newData: Data) => {
		try {
			saveDraft(newData)
			toast.success('Draft saved successfully!')
		} catch (error) {
			toast.error('Failed to save draft.')
			console.error(error)
		}
	}

	// 3. Handle Clear Draft
	const handleClear = () => {
		if (confirm('Are you sure you want to clear your draft? This cannot be undone.')) {
			clearDraft()
			setData(INITIAL_DATA)
			toast.info('Draft cleared.')
		}
	}

	if (isLoading) {
		return <div className="flex h-screen items-center justify-center">Loading editor...</div>
	}

	return (
		<div className="flex flex-col h-screen">
			{/* Optional Header for Controls */}
			<header className="flex justify-between items-center p-4 border-b bg-gray-50 dark:bg-gray-900 flex-shrink-0">
				<div className="flex items-center gap-4">
					<h1 className="font-bold text-xl">Puck Editor (Local Draft)</h1>

					{/* NEW: Preview Button */}
					<a
						href="/editor-preview"
						target="_blank"
						rel="noopener noreferrer"
						className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700 transition-colors flex items-center gap-2"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
							<circle cx="12" cy="12" r="3" />
						</svg>
						Preview
					</a>
				</div>

				<div className="space-x-2">
					<button
						onClick={handleClear}
						className="px-4 py-2 text-sm text-red-600 hover:text-red-800 border border-red-200 rounded hover:bg-red-50 transition-colors"
					>
						Clear Draft
					</button>
					<span className="text-xs text-gray-500 hidden sm:inline">Auto-saves on publish</span>
				</div>
			</header>

			{/* Puck Editor - Takes remaining height */}
			<div className="flex-1">
				<Puck config={config} data={data} onPublish={handlePublish} />
			</div>
		</div>
	)
}
