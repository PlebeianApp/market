// src/routes/editor.tsx
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { authStore } from '@/lib/stores/auth'
import { useEffect } from 'react'
import { z } from 'zod'

// Define search params for the editor
const editorSearchSchema = z.object({
	templateId: z.string().optional(),
})

export const Route = createFileRoute('/editor')({
	validateSearch: editorSearchSchema,
	component: EditorRouteComponent,
})

function EditorRouteComponent() {
	const navigate = useNavigate()
	const { templateId } = Route.useSearch()
	const { isAuthenticated, user } = useStore(authStore)

	// Redirect if not authenticated
	useEffect(() => {
		if (!isAuthenticated) {
			navigate({ to: '/login' })
		}
	}, [isAuthenticated, navigate])

	if (!isAuthenticated) {
		return null
	}

	return <p>test</p>
}
