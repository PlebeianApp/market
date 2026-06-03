import { Puck, createUsePuck } from '@puckeditor/core'
import type { Config, Data } from '@puckeditor/core'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import '@puckeditor/core/puck.css'
import { useEffect, useMemo, useState } from 'react'
import { saveDraft, loadDraft, clearDraft } from '@/lib/cms/storage'
import { toast } from 'sonner'
import { getCMSConfig } from '@/config/cms'
import { useAuth } from '@/lib/stores/auth'
import { Button } from '@/components/ui/button'
import { Eye, Trash2, Save, FileEdit, GlobeIcon } from 'lucide-react'

// Initial empty data
const INITIAL_DATA: Data = {
	root: {},
	content: [],
}

export const Route = createFileRoute('/editor')({
	component: EditorRouteComponent,
})

// Create Puck hook for accessing internal state
const usePuck = createUsePuck()

// Custom Preview Button Component
function PreviewButton() {
	return (
		<Button variant="outline" size="sm" onClick={() => window.open('/editor-preview', '_blank')} className="flex items-center gap-2">
			<Eye className="w-4 h-4" />
			Preview
		</Button>
	)
}

// Custom Clear Draft Button Component
function ClearDraftButton({ onClear }: { onClear: () => void }) {
	const handleClear = () => {
		if (confirm('Are you sure you want to clear your draft? This cannot be undone.')) {
			clearDraft()
			// Trigger the parent to increment the key, forcing a remount
			onClear()
			toast.info('Draft cleared.')
		}
	}

	return (
		<Button
			variant="outline"
			size="sm"
			onClick={handleClear}
			className="flex items-center gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
		>
			<Trash2 className="w-4 h-4" />
			Clear Draft
		</Button>
	)
}

// Custom Save Draft Button Component
function SaveDraftButton() {
	const appState = usePuck((s) => s.appState)

	const handleSave = () => {
		try {
			const currentData = appState.data
			saveDraft(currentData)
			toast.success('Draft saved successfully!')
		} catch (error) {
			toast.error('Failed to save draft.')
			console.error(error)
		}
	}

	return (
		<Button variant="default" size="sm" onClick={handleSave} className="flex items-center gap-2">
			<Save className="w-4 h-4" />
			Save Draft
		</Button>
	)
}

// Custom Publish Button Component
function PublishButton() {
	const appState = usePuck((s) => s.appState)

	const handlePublish = () => {
		try {
			const currentData = appState.data
			saveDraft(currentData)
			toast.success('Draft published successfully!')
		} catch (error) {
			toast.error('Failed to publish draft.')
			console.error(error)
		}
	}

	return (
		<Button
			variant="outline"
			size="sm"
			onClick={handlePublish}
			className="flex items-center gap-2 border-secondary text-secondary hover:text-secondary/90 hover:bg-secondary/10"
		>
			<GlobeIcon className="w-4 h-4" />
			Publish
		</Button>
	)
}

function EditorRouteComponent() {
	const [data, setData] = useState<Data>(INITIAL_DATA)
	const [isLoading, setIsLoading] = useState(true)
	const { user } = useAuth()

	// Use this key to force a complete remount of the Puck editor
	const [editorKey, setEditorKey] = useState(0)

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

	// Handler to clear and refresh
	const handleClearAndRefresh = () => {
		setData(INITIAL_DATA) // Reset local state immediately
		setEditorKey((prev) => prev + 1) // Increment key to force Puck remount
	}

	if (isLoading) {
		return <div className="flex h-screen items-center justify-center">Loading editor...</div>
	}

	return (
		<div className="flex flex-col h-screen">
			{/* Puck Editor - Takes full height */}
			<div className="flex-1 overflow-hidden">
				{/* 
					Key Prop Strategy:
					By passing key={editorKey}, React will completely unmount the old Puck instance
					and mount a new one whenever the key changes. This ensures internal state 
					(resets, undo stacks, etc.) are fully cleared.
				*/}
				<Puck
					key={editorKey}
					config={config}
					data={data}
					onPublish={handlePublish}
					overrides={{
						headerActions: ({ children }) => {
							return (
								<>
									<div className="flex items-center gap-2">
										<ClearDraftButton onClear={handleClearAndRefresh} />
										<PreviewButton />
										<PublishButton />
									</div>
								</>
							)
						},
					}}
				/>
			</div>
		</div>
	)
}
