import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { submitAppSettings } from '@/lib/appSettings'
import { createQueryClient } from '@/lib/queryClient'
import { AppSettingsSchema } from '@/lib/schemas/app'
import { useConfigQuery } from '@/queries/config'
import { configKeys } from '@/queries/queryKeyFactory'
import { useForm, useStore } from '@tanstack/react-form'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { finalizeEvent, generateSecretKey, nip19 } from 'nostr-tools'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'

function npubToHex(pk: string): string {
	if (pk.startsWith('npub1')) {
		const { type, data } = nip19.decode(pk)
		if (type === 'npub') return data as string
		throw new Error('Invalid npub')
	} else if (/^[0-9a-f]{64}$/i.test(pk)) {
		return pk.toLowerCase()
	}
	throw new Error('Invalid public key: must be npub or 64 hex chars')
}

function hexToNpub(pk: string): string {
	if (pk.startsWith('npub1')) {
		return pk
	} else if (/^[0-9a-f]{64}$/i.test(pk)) {
		return nip19.npubEncode(pk)
	}
	throw new Error('Invalid public key: must be npub or 64 hex chars')
}

function formatPubkeyForDisplay(pk: string): string {
	try {
		return hexToNpub(pk)
	} catch (e) {
		return pk // Return as-is if invalid
	}
}

export { npubToHex, hexToNpub, formatPubkeyForDisplay }

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
	const [editorsList, setEditorsList] = useState<string[]>([])
	const [inputValue, setInputValue] = useState('')
	const [editorInputValue, setEditorInputValue] = useState('')

	const form = useForm({
		defaultValues: {
			name: '',
			displayName: '',
			picture: availableLogos[0].value,
			banner: 'https://plebeian.market/banner.svg',
			ownerPk: '',
			contactEmail: '',
			allowRegister: true as boolean,
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

				let ownerPubkeyHex: string
				try {
					ownerPubkeyHex = npubToHex(value.ownerPk)
				} catch (e) {
					toast.error('Invalid owner public key')
					return
				}

				const allAdminsHex = new Set<string>([ownerPubkeyHex])
				for (const admin of adminsList) {
					try {
						allAdminsHex.add(npubToHex(admin))
					} catch (e) {
						toast.error(`Invalid admin public key: ${admin}`)
						return
					}
				}

				const allEditorsHex = new Set<string>()
				for (const editor of editorsList) {
					try {
						allEditorsHex.add(npubToHex(editor))
					} catch (e) {
						toast.error(`Invalid editor public key: ${editor}`)
						return
					}
				}

				// Create 30000 event for admins - Submit this FIRST
				const adminsTags: string[][] = [['d', 'admins'], ...Array.from(allAdminsHex).map((hex) => ['p', hex])]

				let adminsEvent = {
					kind: 30000,
					created_at: Math.floor(Date.now() / 1000),
					tags: adminsTags,
					content: '',
					pubkey: ownerPubkeyHex,
				}

				adminsEvent = finalizeEvent(adminsEvent, generateSecretKey())
				await submitAppSettings(adminsEvent)

				// Create 30000 event for editors - Submit this SECOND (if there are any editors)
				if (allEditorsHex.size > 0) {
					const editorsTags: string[][] = [['d', 'editors'], ...Array.from(allEditorsHex).map((hex) => ['p', hex])]

					let editorsEvent = {
						kind: 30000,
						created_at: Math.floor(Date.now() / 1000),
						tags: editorsTags,
						content: '',
						pubkey: ownerPubkeyHex,
					}

					editorsEvent = finalizeEvent(editorsEvent, generateSecretKey())
					await submitAppSettings(editorsEvent)
				}

				// Create 31990 event - Submit this THIRD
				const appSettingsTags: string[][] = [
					['d', crypto.randomUUID()],
					['k', '30402'],
					['k', '30405'],
					['web', `${window.location.origin}/a/{bech32}`, 'nevent'],
					['web', `${window.location.origin}/p/{bech32}`, 'nprofile'],
					['r', config.appRelay],
				]

				let newEvent = {
					kind: 31990,
					created_at: Math.floor(Date.now() / 1000),
					tags: appSettingsTags,
					content: JSON.stringify({
						...value,
						ownerPk: ownerPubkeyHex,
					}),
					pubkey: ownerPubkeyHex,
				}

				newEvent = finalizeEvent(newEvent, generateSecretKey())
				await submitAppSettings(newEvent)

				// Wait a bit for the events to be processed
				await new Promise((resolve) => setTimeout(resolve, 1000))

				const queryClient = await createQueryClient([config.appRelay])
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
											try {
												npubToHex(field.value)
												return undefined
											} catch (e) {
												return (e as Error).message
											}
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
													onChange={(e) => {
														const value = e.target.value.trim()
														// Always store the input value, but convert to npub if it's valid hex
														try {
															if (/^[0-9a-f]{64}$/i.test(value)) {
																field.handleChange(nip19.npubEncode(value))
															} else {
																field.handleChange(value)
															}
														} catch {
															field.handleChange(value)
														}
													}}
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
								<div className="flex flex-col gap-2">
									<Label>Admins</Label>
									<form.Subscribe
										selector={(state) => state.values.ownerPk}
										children={(ownerPk) =>
											ownerPk && (
												<div className="grid grid-cols-[1fr_auto] items-center">
													<span className="truncate">{formatPubkeyForDisplay(ownerPk)}</span>
													<span>(owner)</span>
												</div>
											)
										}
									/>
									{adminsList.map((admin, index) => (
										<div key={index} className="grid grid-cols-[1fr_auto] items-center">
											<span className="truncate">{formatPubkeyForDisplay(admin)}</span>
											<Button type="button" variant="destructive" onClick={() => setAdminsList(adminsList.filter((_, i) => i !== index))}>
												Remove
											</Button>
										</div>
									))}
									<div className="flex flex-row gap-2">
										<Input
											type="text"
											value={inputValue}
											onChange={(e) => setInputValue(e.target.value)}
											placeholder="Admin npub or hex pubkey"
										/>
										<Button
											type="button"
											onClick={() => {
												const trimmed = inputValue.trim()
												if (trimmed) {
													try {
														npubToHex(trimmed)
														setAdminsList([...adminsList, trimmed])
														setInputValue('')
													} catch (e) {
														toast.error((e as Error).message)
													}
												}
											}}
										>
											Add Admin
										</Button>
									</div>
								</div>

								<div className="flex flex-col gap-2 mt-4">
									<Label>Editors</Label>
									{editorsList.map((editor, index) => (
										<div key={index} className="grid grid-cols-[1fr_auto] items-center">
											<span className="truncate">{formatPubkeyForDisplay(editor)}</span>
											<Button type="button" variant="destructive" onClick={() => setEditorsList(editorsList.filter((_, i) => i !== index))}>
												Remove
											</Button>
										</div>
									))}
									<div className="flex flex-row gap-2">
										<Input
											type="text"
											value={editorInputValue}
											onChange={(e) => setEditorInputValue(e.target.value)}
											placeholder="Editor npub or hex pubkey"
										/>
										<Button
											type="button"
											onClick={() => {
												const trimmed = editorInputValue.trim()
												if (trimmed) {
													try {
														npubToHex(trimmed)
														setEditorsList([...editorsList, trimmed])
														setEditorInputValue('')
													} catch (e) {
														toast.error((e as Error).message)
													}
												}
											}}
										>
											Add Editor
										</Button>
									</div>
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
													onCheckedChange={(checked) => field.handleChange(checked as boolean)}
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
