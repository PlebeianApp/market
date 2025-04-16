import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_dashboard-layout/dashboard/account/profile')({
	component: ProfileComponent,
})

function ProfileComponent() {
	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold">Profile</h1>
			<p>Profile</p>
		</div>
	)
}
