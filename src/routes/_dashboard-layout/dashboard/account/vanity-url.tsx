import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_dashboard-layout/dashboard/account/vanity-url')({
	beforeLoad: () => {
		throw redirect({ to: '/dashboard/account/profile-page' })
	},
})
