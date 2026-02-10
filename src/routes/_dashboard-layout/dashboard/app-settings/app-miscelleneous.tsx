import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CURRENCIES } from '@/lib/constants'
import { submitAppSettings } from '@/lib/appSettings'
import { AppSettingsSchema } from '@/lib/schemas/app'
import { useUserRole } from '@/queries/app-settings'
import { useConfigQuery } from '@/queries/config'
import { configKeys } from '@/queries/queryKeyFactory'
import { useQueryClient } from '@tanstack/react-query'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { createHandlerInfoEventData } from '@/publish/nip89'
import { useForm, useStore } from '@tanstack/react-form'
import { createFileRoute } from '@tanstack/react-router'
import { finalizeEvent, generateSecretKey, nip19 } from 'nostr-tools'
import { toast } from 'sonner'

export const Route = createFileRoute('/_dashboard-layout/dashboard/app-settings/app-miscelleneous')({
	component: AppMiscelleneousComponent,
})

function AppMiscelleneousComponent() {
	useDashboardTitle('App Settings')
	const { data: config } = useConfigQuery()
	const { amIOwner, isLoading: isRoleLoading } = useUserRole(config?.appPublicKey)

	const queryClient = useQueryClient()
	const canManageSettings = amIOwner

	const appSettings = config?.appSettings

	const form = useForm({
		defaultValues: {
			name: appSettings?.name ?? '',
			displayName: appSettings?.displayName ?? '',
			picture: appSettings?.picture ?? '',
			banner: appSettings?.banner ?? '',
			contactEmail: appSettings?.contactEmail ?? '',
			defaultCurrency: appSettings?.defaultCurrency ?? CURRENCIES[0],
			allowRegister: appSettings?.allowRegister ?? true,
			blossom_server: appSettings?.blossom_server ?? '',
			nip96_server: appSettings?.nip96_server ?? '',
			showNostrLink: appSettings?.showNostrLink ?? false,
		},
		validators: {
			onSubmit: ({ value }) => {
				const toValidate = {
					...value,
					ownerPk: appSettings?.ownerPk ?? '',
					// Strip empty optional URL fields so Zod doesn't fail on ""
					picture: value.picture || undefined,
					banner: value.banner || undefined,
					blossom_server: value.blossom_server || undefined,
					nip96_server: value.nip96_server || undefined,
					contactEmail: value.contactEmail || undefined,
				}
				const result = AppSettingsSchema.safeParse(toValidate)
				if (!result.success) {
					return result.error.issues.reduce<Record<string, string>>((acc, curr) => {
						const path = curr.path.join('.')
						acc[path] = curr.message
						return acc
					}, {})
				}
				return undefined
			},
		},
		onSubmit: async ({ value }) => {
			if (!config?.appSettings || !config?.appRelay || !config?.appPublicKey) {
				toast.error('Configuration not loaded')
				return
			}

			try {
				const updatedSettings = {
					...value,
					ownerPk: config.appSettings.ownerPk,
					// Strip empty strings to undefined for optional URL fields
					blossom_server: value.blossom_server || undefined,
					nip96_server: value.nip96_server || undefined,
					contactEmail: value.contactEmail || undefined,
				}

				const handlerId = 'plebeian-market-handler'
				let handlerEvent = createHandlerInfoEventData(config.appSettings.ownerPk, updatedSettings, config.appRelay, handlerId)
				handlerEvent = finalizeEvent(handlerEvent, generateSecretKey())
				await submitAppSettings(handlerEvent)

				// Wait a bit for the event to be processed
				await new Promise((resolve) => setTimeout(resolve, 1000))

				await queryClient.invalidateQueries({ queryKey: configKeys.all })
				await queryClient.refetchQueries({ queryKey: configKeys.all })

				toast.success('Settings updated successfully!')
			} catch (error) {
				console.error('Failed to update settings:', error)
				if (error instanceof Error) {
					toast.error(error.message)
				} else {
					toast.error('Failed to update settings')
				}
			}
		},
	})

	const formErrorMap = useStore(form.store, (state) => state.errorMap)

	if (isRoleLoading) {
		return (
			<div className="p-4 lg:p-6">
				<div className="animate-pulse">Loading...</div>
			</div>
		)
	}

	if (!canManageSettings) {
		return (
			<div className="p-4 lg:p-6">
				<div className="text-muted-foreground">You don't have permission to manage these settings.</div>
			</div>
		)
	}

	const ownerNpub = appSettings?.ownerPk
		? (() => {
				try {
					return nip19.npubEncode(appSettings.ownerPk)
				} catch {
					return appSettings.ownerPk
				}
			})()
		: ''

	return (
		<div>
			<div className="hidden lg:flex sticky top-0 z-10 bg-white border-b py-4 px-4 lg:px-6 items-center justify-between">
				<h1 className="text-2xl font-bold">App Settings</h1>
				<form.Subscribe
					selector={(state) => [state.canSubmit, state.isSubmitting]}
					children={([canSubmit, isSubmitting]) => (
						<Button type="button" disabled={isSubmitting || !canSubmit} onClick={() => form.handleSubmit()} variant="primary">
							{isSubmitting ? 'Saving...' : 'Save Settings'}
						</Button>
					)}
				/>
			</div>

			<form
				onSubmit={(e) => {
					e.preventDefault()
					e.stopPropagation()
					form.handleSubmit()
				}}
				className="space-y-6 p-4 lg:p-6"
			>
				{/* Identity Section */}
				<div className="border rounded-lg p-4 space-y-4">
					<h3 className="text-lg font-semibold">Identity</h3>

					<div>
						<Label className="font-medium">Owner</Label>
						<Input value={ownerNpub} disabled className="border-2 bg-gray-50 text-muted-foreground mt-1" />
						<p className="text-xs text-muted-foreground mt-1">Owner public key cannot be changed.</p>
					</div>

					<form.Field
						name="name"
						validators={{
							onChange: (field) => {
								if (!field.value) return 'Instance name is required'
								return undefined
							},
						}}
					>
						{(field) => (
							<div>
								<Label className="font-medium" htmlFor={field.name}>
									<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Instance name</span>
								</Label>
								<Input
									id={field.name}
									required
									className="border-2 mt-1"
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
									placeholder="Instance name"
								/>
								{field.state.meta.errors?.length > 0 && field.state.meta.isTouched && (
									<div className="text-red-500 text-sm mt-1">{field.state.meta.errors.join(', ')}</div>
								)}
							</div>
						)}
					</form.Field>

					<form.Field
						name="displayName"
						validators={{
							onChange: (field) => {
								if (!field.value) return 'Display name is required'
								return undefined
							},
						}}
					>
						{(field) => (
							<div>
								<Label className="font-medium" htmlFor={field.name}>
									<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Display name</span>
								</Label>
								<Input
									id={field.name}
									required
									className="border-2 mt-1"
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
									placeholder="Display name"
								/>
								{field.state.meta.errors?.length > 0 && field.state.meta.isTouched && (
									<div className="text-red-500 text-sm mt-1">{field.state.meta.errors.join(', ')}</div>
								)}
							</div>
						)}
					</form.Field>

					<form.Field
						name="contactEmail"
						validators={{
							onChange: (field) => {
								if (field.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(field.value)) {
									return 'Please enter a valid email address'
								}
								return undefined
							},
						}}
					>
						{(field) => (
							<div>
								<Label className="font-medium" htmlFor={field.name}>
									Contact email
								</Label>
								<Input
									id={field.name}
									className="border-2 mt-1"
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
									placeholder="Contact email"
									type="email"
								/>
								{field.state.meta.errors?.length > 0 && field.state.meta.isTouched && (
									<div className="text-red-500 text-sm mt-1">{field.state.meta.errors.join(', ')}</div>
								)}
							</div>
						)}
					</form.Field>
				</div>

				{/* Branding Section */}
				<div className="border rounded-lg p-4 space-y-4">
					<h3 className="text-lg font-semibold">Branding</h3>

					<form.Field
						name="picture"
						validators={{
							onChange: (field) => {
								if (!field.value) return 'Logo URL is required'
								try {
									new URL(field.value)
								} catch {
									return 'Please enter a valid URL'
								}
								return undefined
							},
						}}
					>
						{(field) => (
							<div>
								<Label className="font-medium" htmlFor={field.name}>
									<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Logo URL</span>
								</Label>
								<Input
									id={field.name}
									className="border-2 mt-1"
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
									placeholder="https://example.com/logo.png"
								/>
								{field.state.meta.errors?.length > 0 && field.state.meta.isTouched && (
									<div className="text-red-500 text-sm mt-1">{field.state.meta.errors.join(', ')}</div>
								)}
								{field.state.value && !field.state.meta.errors?.length && (
									<div className="mt-2 flex justify-center">
										<img
											className="max-w-28 max-h-28 object-contain"
											src={field.state.value}
											alt="Logo preview"
											onError={(e) => {
												if (e.target instanceof HTMLImageElement) {
													e.target.style.display = 'none'
												}
											}}
											onLoad={(e) => {
												if (e.target instanceof HTMLImageElement) {
													e.target.style.display = ''
												}
											}}
										/>
									</div>
								)}
							</div>
						)}
					</form.Field>

					<form.Field
						name="banner"
						validators={{
							onChange: (field) => {
								if (!field.value) return 'Banner URL is required'
								try {
									new URL(field.value)
								} catch {
									return 'Please enter a valid URL'
								}
								return undefined
							},
						}}
					>
						{(field) => (
							<div>
								<Label className="font-medium" htmlFor={field.name}>
									<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Banner URL</span>
								</Label>
								<Input
									id={field.name}
									className="border-2 mt-1"
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
									placeholder="https://example.com/banner.png"
								/>
								{field.state.meta.errors?.length > 0 && field.state.meta.isTouched && (
									<div className="text-red-500 text-sm mt-1">{field.state.meta.errors.join(', ')}</div>
								)}
								{field.state.value && !field.state.meta.errors?.length && (
									<div className="mt-2">
										<img
											className="max-h-32 w-full object-cover rounded"
											src={field.state.value}
											alt="Banner preview"
											onError={(e) => {
												if (e.target instanceof HTMLImageElement) {
													e.target.style.display = 'none'
												}
											}}
											onLoad={(e) => {
												if (e.target instanceof HTMLImageElement) {
													e.target.style.display = ''
												}
											}}
										/>
									</div>
								)}
							</div>
						)}
					</form.Field>
				</div>

				{/* General Settings Section */}
				<div className="border rounded-lg p-4 space-y-4">
					<h3 className="text-lg font-semibold">General</h3>

					<form.Field name="defaultCurrency">
						{(field) => (
							<div>
								<Label className="font-medium" htmlFor={field.name}>
									Default currency
								</Label>
								<Select onValueChange={(value) => field.handleChange(value)} value={field.state.value}>
									<SelectTrigger className="border-2 mt-1">
										<SelectValue placeholder="Currency" />
									</SelectTrigger>
									<SelectContent>
										{CURRENCIES.map((currency) => (
											<SelectItem key={currency} value={currency}>
												{currency}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						)}
					</form.Field>

					<form.Field name="allowRegister">
						{(field) => (
							<div className="flex items-center space-x-3">
								<Checkbox
									id={field.name}
									checked={field.state.value}
									onCheckedChange={(checked) => field.handleChange(checked as boolean)}
								/>
								<div className="space-y-1">
									<Label htmlFor={field.name} className="font-medium cursor-pointer">
										Allow registration
									</Label>
									<p className="text-sm text-muted-foreground">When enabled, new users can register on this instance.</p>
								</div>
							</div>
						)}
					</form.Field>

					<form.Field name="showNostrLink">
						{(field) => (
							<div className="flex items-center space-x-3">
								<Checkbox
									id={field.name}
									checked={field.state.value}
									onCheckedChange={(checked) => field.handleChange(checked as boolean)}
								/>
								<div className="space-y-1">
									<Label htmlFor={field.name} className="font-medium cursor-pointer">
										Show Nostr link in navigation
									</Label>
									<p className="text-sm text-muted-foreground">When enabled, a "Nostr" link will appear in the main navigation menu.</p>
								</div>
							</div>
						)}
					</form.Field>
				</div>

				{/* Servers Section */}
				<div className="border rounded-lg p-4 space-y-4">
					<h3 className="text-lg font-semibold">Servers</h3>
					<p className="text-sm text-muted-foreground">Configure file storage servers. Leave empty to use defaults.</p>

					<form.Field
						name="blossom_server"
						validators={{
							onChange: (field) => {
								if (field.value) {
									try {
										new URL(field.value)
									} catch {
										return 'Please enter a valid URL'
									}
								}
								return undefined
							},
						}}
					>
						{(field) => (
							<div>
								<Label className="font-medium" htmlFor={field.name}>
									Blossom server
								</Label>
								<Input
									id={field.name}
									className="border-2 mt-1"
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
									placeholder="https://blossom.example.com"
								/>
								{field.state.meta.errors?.length > 0 && field.state.meta.isTouched && (
									<div className="text-red-500 text-sm mt-1">{field.state.meta.errors.join(', ')}</div>
								)}
							</div>
						)}
					</form.Field>

					<form.Field
						name="nip96_server"
						validators={{
							onChange: (field) => {
								if (field.value) {
									try {
										new URL(field.value)
									} catch {
										return 'Please enter a valid URL'
									}
								}
								return undefined
							},
						}}
					>
						{(field) => (
							<div>
								<Label className="font-medium" htmlFor={field.name}>
									NIP-96 server
								</Label>
								<Input
									id={field.name}
									className="border-2 mt-1"
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
									placeholder="https://nip96.example.com"
								/>
								{field.state.meta.errors?.length > 0 && field.state.meta.isTouched && (
									<div className="text-red-500 text-sm mt-1">{field.state.meta.errors.join(', ')}</div>
								)}
							</div>
						)}
					</form.Field>
				</div>

				{/* Form errors and submit button */}
				{formErrorMap.onSubmit ? (
					<div className="text-red-500 text-sm">
						<em>There was an error: {Object.values(formErrorMap.onSubmit).join(', ')}</em>
					</div>
				) : null}

				<form.Subscribe
					selector={(state) => [state.canSubmit, state.isSubmitting]}
					children={([canSubmit, isSubmitting]) => (
						<Button type="submit" className="w-full lg:hidden" disabled={isSubmitting || !canSubmit} variant="primary">
							{isSubmitting ? 'Saving...' : 'Save Settings'}
						</Button>
					)}
				/>
			</form>
		</div>
	)
}
