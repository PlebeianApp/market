import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { submitAppSettings } from '@/lib/appSettings'
import { queryClient } from '@/lib/queryClient'
import { useConfigQuery } from '@/queries/config'
import { configKeys } from '@/queries/queryKeyFactory'
import { NDKEvent, NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'
import { useForm } from '@tanstack/react-form'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { nip19 } from 'nostr-tools'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AppSettingsSchema } from '@/lib/schemas/app'

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
	const [logoUrl, setLogoUrl] = useState(availableLogos[0].value)
	const [selectedCurrency, setSelectedCurrency] = useState(currencies[0])
	const [checked, setChecked] = useState(true)

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
		},
		validators: {
			onChange: AppSettingsSchema,
		},
		onSubmit: async ({ value }) => {
			try {
				if (!config?.appRelay) {
					toast.error('Please enter a relay URL')
					return
				}

				const formDataNostrEvent = new NDKEvent(undefined, {
					content: JSON.stringify({
						...value,
						adminsList,
						relayUrl: config.appRelay,
					}),
					kind: 31990,
					pubkey: value.ownerPk,
					created_at: Math.floor(Date.now() / 1000),
					tags: [],
				})

				const pkSigner = NDKPrivateKeySigner.generate()

				await submitAppSettings(formDataNostrEvent, pkSigner)
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
				form.setFieldValue('ownerPk', nip19.npubEncode(user))
			}
		} catch (error) {
			toast.error('Failed to get public key from extension')
		}
	}

	const fillDebugData = () => {
		const fakeOwnerSk = 'nsec1n5xwddq9yrpnvy229cnfmplyzzcqjq4ndm9w79mlwdl83r2d5juqqcu3g9'
		form.setFieldValue('name', 'test-market')
		form.setFieldValue('displayName', 'Test Market')
		form.setFieldValue('picture', availableLogos[0].value)
		form.setFieldValue('banner', 'https://plebeian.market/banner.svg')
		form.setFieldValue('ownerPk', 'npub10g6zk8la7ay9p4zszdt65xlfacn9hkanrkzl6k6g7p0e3xcjvtkqqppkqj')
		form.setFieldValue('contactEmail', 'test@example.com')
		form.setFieldValue('allowRegister', true)
		form.setFieldValue('defaultCurrency', 'USD')
		setAdminsList(['npub1mjj4n95c6usl0kvpwwlqlm8pwg99fnrpqajun88pjqx5qgd2k92qq4pujq'])
	}

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
								<Button variant="outline" onClick={fillDebugData}>
									Fill Debug Data
								</Button>
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

								<div>
									<Label className="font-bold">Owner npub</Label>
									<div className="flex flex-row gap-2">
										<Input
											className="border-2"
											name="ownerPk"
											value={form.getFieldValue('ownerPk')}
											onChange={(e) => form.setFieldValue('ownerPk', e.target.value)}
											placeholder="Owner npub"
										/>
										<Button variant="outline" onClick={getOwnerPubkey}>
											<span className="text-black">Get Key</span>
										</Button>
									</div>
									{form.getFieldMeta('ownerPk')?.errors && (
										<div className="text-red-500 text-sm mt-1">{form.getFieldMeta('ownerPk')?.errors.join(', ')}</div>
									)}
								</div>

								<div>
									<Label className="font-bold" htmlFor="name">
										<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Instance name</span>
									</Label>
									<Input
										required
										className="border-2"
										name="name"
										value={form.getFieldValue('name')}
										onChange={(e) => form.setFieldValue('name', e.target.value)}
										placeholder="Instance name"
									/>
									{form.getFieldMeta('name')?.errors && (
										<div className="text-red-500 text-sm mt-1">{form.getFieldMeta('name')?.errors.join(', ')}</div>
									)}
								</div>

								<div>
									<Label className="font-bold" htmlFor="displayName">
										<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Display name</span>
									</Label>
									<Input
										required
										className="border-2"
										name="displayName"
										value={form.getFieldValue('displayName')}
										onChange={(e) => form.setFieldValue('displayName', e.target.value)}
										placeholder="Display name"
									/>
									{form.getFieldMeta('displayName')?.errors && (
										<div className="text-red-500 text-sm mt-1">{form.getFieldMeta('displayName')?.errors.join(', ')}</div>
									)}
								</div>

								<div className="flex flex-col gap-2">
									<div>
										<Label className="font-bold">Logo URL</Label>
										<Select
											onValueChange={(value) => {
												setLogoUrl(value)
												form.setFieldValue('picture', value)
											}}
											defaultValue={logoUrl}
										>
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
										{logoUrl && (
											<img
												className="max-w-28"
												src={logoUrl}
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

								<div>
									<Label className="font-bold">Contact email</Label>
									<Input
										className="border-2"
										name="contactEmail"
										value={form.getFieldValue('contactEmail')}
										onChange={(e) => form.setFieldValue('contactEmail', e.target.value)}
										placeholder="Contact email"
										type="email"
									/>
									{form.getFieldMeta('contactEmail')?.errors && (
										<div className="text-red-500 text-sm mt-1">{form.getFieldMeta('contactEmail')?.errors.join(', ')}</div>
									)}
								</div>

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
									<div>
										<Label className="font-bold">Default currency</Label>
										<Select
											onValueChange={(value) => {
												setSelectedCurrency(value)
												form.setFieldValue('defaultCurrency', value)
											}}
											defaultValue={selectedCurrency}
										>
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
									<div className="flex items-center space-x-2">
										<Checkbox
											id="allowRegister"
											checked={checked}
											onCheckedChange={(value) => {
												setChecked(value === true)
												form.setFieldValue('allowRegister', value === true)
											}}
											name="allowRegister"
										/>
										<Label htmlFor="allowRegister" className="font-bold">
											Allow registration
										</Label>
									</div>
								</div>

								<Separator className="my-8" />

								<form.Subscribe
									selector={(state) => [state.canSubmit, state.isSubmitting]}
									children={([canSubmit, isSubmitting]) => (
										<Button type="submit" className="w-full" disabled={!canSubmit}>
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
