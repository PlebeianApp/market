import { createFileRoute } from '@tanstack/react-router'
import { useConfigQuery } from '@/queries/config'
import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

export const Route = createFileRoute('/setup')({
	component: SetupRoute,
})

function SetupRoute() {
	const { data: config } = useConfigQuery()
	const navigate = useNavigate()

	useEffect(() => {
		// If app is already set up, redirect to home
		if (config?.appSettings) {
			navigate({ to: '/' })
		}
	}, [config, navigate])

	return (
		<div className="container mx-auto p-4">
			<h1 className="text-2xl font-bold mb-4">Welcome to Plebeian Market Setup</h1>
			<p className="mb-4">This is the first time you're running Plebeian Market. Let's set up your marketplace.</p>
			{/* TODO: Add setup form */}
		</div>
	)
}
