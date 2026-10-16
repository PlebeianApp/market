import { useEffect, useMemo, useState } from 'react'
import {
	PickupLocationDialogView,
	type GeocodedPickupLocation,
	type PickupLocationSummary,
} from '@ui/components/dialogs/PickupLocationDialogView'

interface PickupAddress {
	street: string
	city: string
	state: string
	postalCode: string
	country: string
}

interface PickupLocation {
	name: string
	address: PickupAddress
}

interface PickupLocationDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	locations: PickupLocation[]
	vendorName?: string
}

function formatAddress(address: PickupAddress): string {
	return [address.street, address.city, address.state, address.postalCode, address.country].filter(Boolean).join(', ')
}

async function geocode(address: string): Promise<{ lat: number; lon: number } | null> {
	const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`, {
		headers: { 'User-Agent': 'PlebeianMarket/1.0' },
	})
	if (!response.ok) {
		console.error(`Geocoding failed for: ${address}`)
		return null
	}
	const data = await response.json()
	return data && data.length > 0 ? { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) } : null
}

export function PickupLocationDialog({ open, onOpenChange, locations, vendorName }: PickupLocationDialogProps) {
	const [geocodedLocations, setGeocodedLocations] = useState<GeocodedPickupLocation[]>([])
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const summaries = useMemo<PickupLocationSummary[]>(
		() => locations.map((location) => ({ name: location.name, address: formatAddress(location.address) })),
		[locations],
	)

	useEffect(() => {
		if (!open) {
			setGeocodedLocations([])
			setError(null)
			return
		}
		if (summaries.length === 0) return

		const geocodeAll = async () => {
			setLoading(true)
			setError(null)
			try {
				const results: GeocodedPickupLocation[] = []
				for (const location of summaries) {
					const point = await geocode(location.address)
					if (point) results.push({ ...location, ...point })
					// Nominatim rate limit.
					if (summaries.length > 1) await new Promise((resolve) => setTimeout(resolve, 200))
				}
				if (results.length === 0) setError('Could not find any locations on map')
				else setGeocodedLocations(results)
			} catch (err) {
				console.error('Geocoding error:', err)
				setError('Failed to load map locations')
			} finally {
				setLoading(false)
			}
		}

		void geocodeAll()
	}, [open, summaries])

	return (
		<PickupLocationDialogView
			open={open}
			onOpenChange={onOpenChange}
			locations={summaries}
			geocodedLocations={geocodedLocations}
			loading={loading}
			error={error}
			vendorName={vendorName}
		/>
	)
}
