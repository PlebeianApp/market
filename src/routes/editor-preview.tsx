// src/routes/editor-preview.tsx
import { Puck, Render } from '@puckeditor/core'
import type { Data } from '@puckeditor/core'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { loadDraft } from '@/lib/cms/storage'
import { getCMSConfig, type CMSRootProps } from '@/config/cms'
import { useAuth } from '@/lib/stores/auth'
import { applyLocalTheme } from '@/lib/utils/theme'
import '@puckeditor/core/puck.css'

// Initial empty data fallback
const EMPTY_DATA: Data = { root: {}, content: [] }

export const Route = createFileRoute('/editor-preview')({
	component: PreviewRouteComponent,
})

function PreviewRouteComponent() {
	const [data, setData] = useState<Data | null>(null)
	const [isLoading, setIsLoading] = useState(true)
	const [themeElement, setThemeElement] = useState<HTMLDivElement | null>(null)
	const { user } = useAuth()

	const config = useMemo(() => {
		return getCMSConfig(user ?? undefined)
	}, [user?.pubkey])

	useEffect(() => {
		// Load directly from storage
		const saved = loadDraft()
		if (saved) {
			setData(saved)
		} else {
			// If no draft, show empty or a "No draft found" message
			setData(EMPTY_DATA)
		}
		setIsLoading(false)
	}, [])

	const rootProps = data?.root.props as CMSRootProps

	// Apply theme when data changes
	useEffect(() => {
		if (themeElement && rootProps?.theme) {
			applyLocalTheme(themeElement, rootProps.theme)
		} else if (themeElement) {
			// Clear theme if none is set
			themeElement.style.cssText = ''
		}
	}, [themeElement, rootProps?.theme])

	if (isLoading) {
		return <div className="flex h-screen items-center justify-center">Loading preview...</div>
	}

	if (!data || data.content.length === 0) {
		return (
			<div className="flex h-screen flex-col items-center justify-center bg-gray-50 text-gray-600">
				<h1 className="text-2xl font-bold mb-4">No Draft Found</h1>
				<p className="mb-6">There is currently no saved draft to preview.</p>
				<a href="/editor" className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
					Go to Editor
				</a>
			</div>
		)
	}

	return (
		<div className="min-h-screen bg-background" ref={setThemeElement}>
			{/* Optional: Back to Editor Button */}
			<div className="fixed top-4 right-4 z-50">
				<a
					href="/editor"
					className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded shadow-lg hover:bg-gray-800 transition-colors"
				>
					← Back to Editor
				</a>
			</div>

			{/* Render the Puck content */}
			<Render config={config} data={data} />
		</div>
	)
}
