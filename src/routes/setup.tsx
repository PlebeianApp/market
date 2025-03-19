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
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { nip19 } from 'nostr-tools'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

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

	// Default relay URL if environment variable isn't available
	const defaultRelayUrl = 'ws://localhost:10547'

	// Form state
	const [checked, setChecked] = useState(true)
	const [selectedCurrency, setSelectedCurrency] = useState(currencies[0])
	const [adminsList, setAdminsList] = useState<string[]>([])
	const [inputValue, setInputValue] = useState('')
	const [logoUrl, setLogoUrl] = useState(availableLogos[0].value)
	const [formValues, setFormValues] = useState({
		instanceName: '',
		contactEmail: '',
		ownerPk: '',
		relayUrl: defaultRelayUrl,
	})

	useEffect(() => {
		if (config?.appSettings) {
			navigate({ to: '/' })
		}
	}, [config, navigate])

	const copyToClipboard = async (text: string) => {
		try {
			await navigator.clipboard.writeText(text)
			toast.success('Copied to clipboard')
		} catch (err) {
			toast.error('Failed to copy')
		}
	}

	const getOwnerPubkey = async () => {
		try {
			// @ts-ignore - assuming window.nostr is available from extension
			const user = await window.nostr?.getPublicKey()
			if (user) {
				setFormValues({
					...formValues,
					ownerPk: nip19.npubEncode(user),
				})
			}
		} catch (error) {
			toast.error('Failed to get public key from extension')
		}
	}

	async function handleSubmit(event: React.FormEvent) {
		event.preventDefault()

		try {
			const formData = {
				instanceName: formValues.instanceName,
				ownerPk: formValues.ownerPk,
				contactEmail: formValues.contactEmail || undefined,
				logoUrl: logoUrl,
				allowRegister: checked,
				defaultCurrency: selectedCurrency,
				adminsList: adminsList,
				relayUrl: formValues.relayUrl,
			}

			await submitAppSettings(formData)

			// Invalidate the config query to force a refresh
			await queryClient.invalidateQueries({ queryKey: configKeys.all })

			// Optionally wait for the query to settle to ensure we have fresh data
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
	}

	return (
		<div className="container mx-auto px-4 py-10">
			<div className="max-w-2xl mx-auto flex flex-col gap-2">
				<main>
					<div>
						<div className="container">
							<h2 className="text-2xl font-bold mb-4">Instance Setup</h2>
							<Separator className="my-2" />
							<form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
											placeholder="Owner npub"
											type="text"
											value={formValues.ownerPk}
											onChange={(e) => setFormValues({ ...formValues, ownerPk: e.target.value })}
										/>
										<Button variant="outline" onClick={getOwnerPubkey}>
											<span className="text-black">Get Key</span>
										</Button>
									</div>
								</div>

								<div>
									<Label className="font-bold" htmlFor="instanceName">
										<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Instance name</span>
									</Label>
									<Input
										required
										className="border-2"
										name="instanceName"
										placeholder="Instance name"
										id="instanceName"
										value={formValues.instanceName}
										onChange={(e) => setFormValues({ ...formValues, instanceName: e.target.value })}
									/>
								</div>

								<div className="flex flex-col gap-2">
									<div>
										<Label className="font-bold">Logo URL</Label>
										<Select onValueChange={setLogoUrl} defaultValue={logoUrl}>
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
										placeholder="Contact email"
										type="email"
										value={formValues.contactEmail}
										onChange={(e) => setFormValues({ ...formValues, contactEmail: e.target.value })}
									/>
								</div>

								<div>
									<Label className="font-bold required-mark">Relay URL</Label>
									<Input
										required
										className="border-2"
										name="relayUrl"
										placeholder={defaultRelayUrl}
										value={formValues.relayUrl}
										onChange={(e) => setFormValues({ ...formValues, relayUrl: e.target.value })}
									/>
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
										<Select onValueChange={setSelectedCurrency} defaultValue={selectedCurrency}>
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
											onCheckedChange={(value) => setChecked(value === true)}
											name="allowRegister"
										/>
										<Label htmlFor="allowRegister" className="font-bold">
											Allow registration
										</Label>
									</div>
								</div>

								<Separator className="my-8" />

								<Button type="submit" className="w-full">
									Submit
								</Button>
							</form>
						</div>
					</div>
				</main>
			</div>
		</div>
	)
}
