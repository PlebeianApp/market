import { Edit, Shield, ShieldCheck, UserPlus } from 'lucide-react'
import type { ComponentType, ReactNode, SVGProps } from 'react'
import { Button } from '../primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../primitives/card'
import { Label } from '../primitives/label'

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

export interface SettingsPageHeaderProps {
	icon: IconComponent
	title: string
	description: string
}

function SettingsHeading({ icon: Icon, title, description }: SettingsPageHeaderProps) {
	return (
		<div className="flex items-center gap-3">
			<Icon className="h-6 w-6 text-muted-foreground" />
			<div>
				<h1 className="text-2xl font-bold">{title}</h1>
				<p className="text-sm text-muted-foreground">{description}</p>
			</div>
		</div>
	)
}

/** Sticky desktop page header used across operator settings pages. */
export function SettingsPageHeader(props: SettingsPageHeaderProps) {
	return (
		<div className="sticky top-0 z-10 hidden items-center justify-between border-b bg-white px-4 py-4 lg:flex lg:px-6">
			<SettingsHeading {...props} />
		</div>
	)
}

export function SettingsMobileHeader(props: SettingsPageHeaderProps) {
	return (
		<div className="mb-6 lg:hidden">
			<SettingsHeading {...props} />
		</div>
	)
}

export function SettingsLoadingSkeleton() {
	return (
		<div className="space-y-6 p-6">
			<div className="animate-pulse">
				<div className="mb-4 h-8 w-1/4 rounded bg-gray-200"></div>
				<div className="space-y-3">
					<div className="h-4 w-1/2 rounded bg-gray-200"></div>
					<div className="h-4 w-1/3 rounded bg-gray-200"></div>
				</div>
			</div>
		</div>
	)
}

/** Shown when the host's permission check fails; the check itself stays in the host. */
export function SettingsAccessDenied({ header, message }: { header: SettingsPageHeaderProps; message: string }) {
	const Icon = header.icon
	return (
		<div className="space-y-6 p-6">
			<SettingsPageHeader {...header} />
			<Card>
				<CardContent className="p-6">
					<div className="text-center">
						<Icon className="mx-auto mb-4 h-16 w-16 text-gray-400" />
						<h3 className="mb-2 text-lg font-medium">Access Denied</h3>
						<p className="text-gray-600">{message}</p>
					</div>
				</CardContent>
			</Card>
		</div>
	)
}

export interface RoleAction {
	label: string
	icon: IconComponent
	/** Tailwind text color for the icon. */
	tone: string
	onSelect: () => void
}

export function RoleActionButtons({ actions, disabled }: { actions: readonly RoleAction[]; disabled: boolean }) {
	if (actions.length === 0) return null
	return (
		<>
			{actions.map((action) => {
				const Icon = action.icon
				return (
					<Button
						key={action.label}
						variant="outline"
						size="sm"
						onClick={action.onSelect}
						disabled={disabled}
						title={action.label}
						aria-label={action.label}
						className="h-8 w-8 p-0"
					>
						<Icon className={`h-4 w-4 ${action.tone}`} />
					</Button>
				)
			})}
		</>
	)
}

export interface TeamRoleSectionProps {
	role: 'admin' | 'editor'
	/** Host-rendered member rows (identity + actions). */
	members: readonly { key: string; content: ReactNode }[]
}

const ROLE_COPY = {
	admin: {
		icon: ShieldCheck,
		emptyIcon: Shield,
		title: 'Administrators',
		description: 'Users with administrative privileges can manage the marketplace, products, and settings.',
		empty: 'No administrators found',
	},
	editor: {
		icon: Edit,
		emptyIcon: Edit,
		title: 'Editors',
		description: 'Users with editor privileges can manage content but have limited administrative access.',
		empty: 'No editors found',
	},
} as const

export function TeamRoleSection({ role, members }: TeamRoleSectionProps) {
	const copy = ROLE_COPY[role]
	const { icon: Icon, emptyIcon: EmptyIcon } = copy
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Icon className="h-5 w-5" />
					{copy.title}
				</CardTitle>
				<CardDescription>{copy.description}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{members.length === 0 ? (
					<div className="py-8 text-center text-gray-500">
						<EmptyIcon className="mx-auto mb-3 h-12 w-12 text-gray-300" />
						<p>{copy.empty}</p>
					</div>
				) : (
					<div className="space-y-3">
						{members.map((member) => (
							<div key={member.key}>{member.content}</div>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	)
}

export function AddTeamMemberCard({ role, search }: { role: 'admin' | 'editor'; search: ReactNode }) {
	const isAdmin = role === 'admin'
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<UserPlus className="h-5 w-5" />
					{isAdmin ? 'Add Administrator' : 'Add Editor'}
				</CardTitle>
				<CardDescription>{isAdmin ? 'Search for a user to add as administrator.' : 'Search for a user to add as editor.'}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="space-y-2">
					<Label>Search for User</Label>
					{search}
				</div>
				<div className="text-xs text-gray-500">
					{isAdmin
						? 'Note: New administrators will have full access to manage the marketplace settings and content.'
						: 'Note: New editors will have limited access to manage content but cannot modify administrative settings.'}
				</div>
			</CardContent>
		</Card>
	)
}

export function TeamPermissionsCard({ isOwner }: { isOwner: boolean }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Your Permissions</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				<div className="flex items-center gap-3">
					{isOwner ? <ShieldCheck className="h-5 w-5 text-green-600" /> : <Shield className="h-5 w-5 text-blue-600" />}
					<div>
						<div className="font-medium">{isOwner ? 'Owner' : 'Administrator'}</div>
						<div className="text-sm text-gray-600">
							{isOwner
								? 'You have full control over the marketplace and can manage all administrators.'
								: 'You can manage marketplace settings and content but cannot add/remove administrators.'}
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	)
}
