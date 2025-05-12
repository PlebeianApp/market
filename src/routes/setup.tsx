import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { submitAppSettings } from '@/lib/appSettings'
import { createQueryClient } from '@/lib/queryClient'
import { useConfigQuery } from '@/queries/config'
import { configKeys } from '@/queries/queryKeyFactory'
import { useForm, useStore } from '@tanstack/react-form'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { finalizeEvent, generateSecretKey, nip19 } from 'nostr-tools'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AppSettingsSchema } from '@/lib/schemas/app'
import { z } from 'zod'

export const Route = createFileRoute('/setup')({
	component: SetupRoute,
})

const availableLogos = [
	{ label: 'Default Logo', value: 'https://plebeian.market/logo.svg' },
	{ label: 'Alternative Logo', value: 'https://plebeian.market/alt-logo.svg' },
]

const currencies = ['USD', 'EUR', 'BTC', 'SATS']

function SetupRoute() {
	const { data: config } = useConfigQuery()
	const navigate = useNavigate()
	const [adminsList, setAdminsList] = useState<string[]>([])
	const [inputValue, setInputValue] = useState('')

	const form = useForm({
		defaultValues: {
			name: '',
			displayName: '',
			picture: availableLogos[0].value,
			banner: 'https://plebeian.market/banner.svg',
			ownerPk: '',
			contactEmail: '',
			allowRegister: true,
			defaultCurrency: currencies[0],
		} satisfies z.infer<typeof AppSettingsSchema>,
		validators: {
			onSubmit: ({ value }) => {
				const result = AppSettingsSchema.safeParse(value)
				if (!result.success) {
					return result.error.errors.reduce<Record<string, string>>((acc, curr) => {
						const path = curr.path.join('.')
						acc[path] = curr.message
						return acc
					}, {})
				}
				return undefined
			},
		},
		onSubmit: async ({ value }) => {
			try {
				if (!config?.appRelay) {
					toast.error('Please enter a relay URL')
					return
				}

				let newEvent = {
					kind: 31990,
					created_at: Math.floor(Date.now() / 1000),
					tags: [] as string[][],
					content: JSON.stringify({
						...value,
						adminsList,
						relayUrl: config.appRelay,
					}),
					pubkey: value.ownerPk,
				}

				newEvent = finalizeEvent(newEvent, generateSecretKey())
				await submitAppSettings(newEvent)
				const queryClient = await createQueryClient(config.appRelay)
				await queryClient.invalidateQueries({ queryKey: configKeys.all })
				await queryClient.refetchQueries({ queryKey: configKeys.all })

				toast.success('App settings successfully updated!')
				navigate({ to: '/' })
			} catch (e) {
				console.error('Failed to submit form', e)
				if (e instanceof Error) {
					toast.error(e.message)
				} else {
					toast.error('An unknown error occurred')
				}
			}
		},
	})

	const getOwnerPubkey = async (event: React.FormEvent) => {
		event.preventDefault()
		try {
			// @ts-ignore - assuming window.nostr is available from extension
			const user = await window.nostr?.getPublicKey()
			if (user) {
				const npub = nip19.npubEncode(user)
				form.setFieldValue('ownerPk', npub)
				setInputValue(npub)
			}
		} catch (error) {
			toast.error('Failed to get public key from extension')
		}
	}

	const formErrorMap = useStore(form.store, (state) => state.errorMap)

	useEffect(() => {
		if (config?.appSettings) {
			navigate({ to: '/' })
		}
	}, [config, navigate])

	return (
		<div className="container mx-auto px-4 py-10">
			<div className="max-w-2xl mx-auto flex flex-col gap-2">
				<main>
					<div>
						<div className="container">
							<div className="flex justify-between items-center mb-4">
								<h2 className="text-2xl font-bold">Instance Setup</h2>
							</div>
							<Separator className="my-2" />
							<form
								onSubmit={(e) => {
									e.preventDefault()
									e.stopPropagation()
									form.handleSubmit()
								}}
								className="flex flex-col gap-4"
							>
								<h3 className="text-xl font-semibold">Identity</h3>
								<div>
									<Label className="font-bold">Instance Identity</Label>
									<div className="text-sm text-gray-500 mb-4">
										This instance will be identified by a public key derived from your server's APP_PRIVATE_KEY environment variable.
									</div>
								</div>

								<form.Field
									name="ownerPk"
									validators={{
										onChange: (field) => {
											if (!field.value) return 'Owner public key is required'
											if (!field.value.startsWith('npub')) return 'Must be a valid npub'
											return undefined
										},
									}}
								>
									{(field) => (
										<div>
											<Label className="font-bold" htmlFor={field.name}>
												Owner npub
											</Label>
											<div className="flex flex-row gap-2">
												<Input
													id={field.name}
													className="border-2"
													name={field.name}
													value={field.state.value}
													onChange={(e) => field.handleChange(e.target.value)}
													onBlur={field.handleBlur}
													placeholder="Owner npub"
												/>
												<Button type="button" variant="outline" onClick={getOwnerPubkey}>
													<span className="text-black">Get Key</span>
												</Button>
											</div>
											{field.state.meta.errors?.length > 0 && field.state.meta.isTouched && (
												<div className="text-red-500 text-sm mt-1">{field.state.meta.errors.join(', ')}</div>
											)}
										</div>
									)}
								</form.Field>

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
											<Label className="font-bold" htmlFor={field.name}>
												<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Instance name</span>
											</Label>
											<Input
												id={field.name}
												required
												className="border-2"
												name={field.name}
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
											<Label className="font-bold" htmlFor={field.name}>
												<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Display name</span>
											</Label>
											<Input
												id={field.name}
												required
												className="border-2"
												name={field.name}
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

								<form.Field name="picture">
									{(field) => (
										<div className="flex flex-col gap-2">
											<div>
												<Label className="font-bold" htmlFor={field.name}>
													Logo URL
												</Label>
												<Select onValueChange={(value) => field.handleChange(value)} defaultValue={field.state.value}>
													<SelectTrigger className="border-2">
														<SelectValue placeholder="Select logo" />
													</SelectTrigger>
													<SelectContent>
														{availableLogos.map((logo) => (
															<SelectItem key={logo.value} value={logo.value}>
																{logo.label}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</div>
											<div className="self-center">
												{field.state.value && (
													<img
														className="max-w-28"
														src={field.state.value}
														alt="logo preview"
														onError={(e) => {
															if (e.target instanceof HTMLImageElement) {
																e.target.src = availableLogos[0].value
															}
														}}
													/>
												)}
											</div>
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
											<Label className="font-bold" htmlFor={field.name}>
												Contact email
											</Label>
											<Input
												id={field.name}
												className="border-2"
												name={field.name}
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

								<Separator className="my-2" />

								<h3 className="text-xl font-semibold">Crew</h3>
								{adminsList.map((admin, index) => (
									<div key={index} className="grid grid-cols-[1fr_auto] items-center">
										<span className="truncate">{admin}</span>
										<Button type="button" variant="destructive" onClick={() => setAdminsList(adminsList.filter((_, i) => i !== index))}>
											Remove
										</Button>
									</div>
								))}

								<div className="flex flex-row gap-2">
									<Input type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} placeholder="Admin npub" />
									<Button
										type="button"
										onClick={() => {
											const trimmed = inputValue.trim()
											if (trimmed) {
												setAdminsList([...adminsList, trimmed])
												setInputValue('')
											}
										}}
									>
										Add Admin
									</Button>
								</div>

								<Separator className="my-2" />

								<h3 className="text-xl font-semibold">Miscellanea</h3>
								<div className="flex flex-col gap-4">
									<form.Field name="defaultCurrency">
										{(field) => (
											<div>
												<Label className="font-bold" htmlFor={field.name}>
													Default currency
												</Label>
												<Select onValueChange={(value) => field.handleChange(value)} defaultValue={field.state.value}>
													<SelectTrigger className="border-2">
														<SelectValue placeholder="Currency" />
													</SelectTrigger>
													<SelectContent>
														{currencies.map((currency) => (
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
											<div className="flex items-center space-x-2">
												<Checkbox
													id={field.name}
													checked={field.state.value}
													onCheckedChange={(value) => field.handleChange(value === true)}
													name={field.name}
												/>
												<Label htmlFor={field.name} className="font-bold">
													Allow registration
												</Label>
											</div>
										)}
									</form.Field>
								</div>

								<Separator className="my-8" />

								{formErrorMap.onSubmit ? (
									<div>
										<em>There was an error on the form: {Object.values(formErrorMap.onSubmit).join(', ')}</em>
									</div>
								) : null}

								<form.Subscribe
									selector={(state) => [state.canSubmit, state.isSubmitting]}
									children={([canSubmit, isSubmitting]) => (
										<Button type="submit" className="w-full" disabled={isSubmitting || !canSubmit}>
											{isSubmitting ? 'Submitting...' : 'Submit'}
										</Button>
									)}
								/>
							</form>
						</div>
					</div>
				</main>
			</div>
		</div>
	)
}
