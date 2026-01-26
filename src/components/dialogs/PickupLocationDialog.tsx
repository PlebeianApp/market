import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { MapPin } from 'lucide-react'
import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix for default marker icons in react-leaflet
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
	iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
	iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
	shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

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

interface GeocodedLocation {
	name: string
	address: string
	lat: number
	lon: number
}

// Component to fit map bounds to all markers
function MapBoundsUpdater({ locations }: { locations: GeocodedLocation[] }) {
	const map = useMap()

	useEffect(() => {
		if (locations.length === 0) return

		if (locations.length === 1) {
			map.setView([locations[0].lat, locations[0].lon], 15)
		} else {
			const bounds = L.latLngBounds(locations.map((loc) => [loc.lat, loc.lon]))
			map.fitBounds(bounds, { padding: [50, 50] })
		}
	}, [map, locations])

	return null
}

function formatAddress(address: PickupAddress): string {
	return [address.street, address.city, address.state, address.postalCode, address.country].filter(Boolean).join(', ')
}

export function PickupLocationDialog({ open, onOpenChange, locations, vendorName }: PickupLocationDialogProps) {
	const [geocodedLocations, setGeocodedLocations] = useState<GeocodedLocation[]>([])
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		if (!open || locations.length === 0) return

		const geocodeAllLocations = async () => {
			setLoading(true)
			setError(null)

			try {
				const results: GeocodedLocation[] = []

				for (const location of locations) {
					const formattedAddress = formatAddress(location.address)
					const query = encodeURIComponent(formattedAddress)

					const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${query}&limit=1`, {
						headers: {
							'User-Agent': 'PlebeianMarket/1.0',
						},
					})

					if (!response.ok) {
						console.error(`Geocoding failed for: ${formattedAddress}`)
						continue
					}

					const data = await response.json()

					if (data && data.length > 0) {
						results.push({
							name: location.name,
							address: formattedAddress,
							lat: parseFloat(data[0].lat),
							lon: parseFloat(data[0].lon),
						})
					}

					// Add a small delay between requests to respect Nominatim rate limits
					if (locations.length > 1) {
						await new Promise((resolve) => setTimeout(resolve, 200))
					}
				}

				if (results.length === 0) {
					setError('Could not find any locations on map')
				} else {
					setGeocodedLocations(results)
				}
			} catch (err) {
				console.error('Geocoding error:', err)
				setError('Failed to load map locations')
			} finally {
				setLoading(false)
			}
		}

		geocodeAllLocations()
	}, [open, locations])

	// Reset state when dialog closes
	useEffect(() => {
		if (!open) {
			setGeocodedLocations([])
			setError(null)
		}
	}, [open])

	const hasMultipleLocations = locations.length > 1

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg max-w-[calc(100%-2rem)] bg-white">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<MapPin className="w-5 h-5" />
						{hasMultipleLocations ? 'Pickup Locations' : 'Pickup Location'}
					</DialogTitle>
					<DialogDescription>
						{vendorName
							? `${vendorName}'s pickup ${hasMultipleLocations ? 'locations' : 'location'}`
							: `Vendor pickup ${hasMultipleLocations ? 'locations' : 'location'}`}
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-4 py-4">
					{hasMultipleLocations && (
						<div className="text-sm space-y-2 max-h-[120px] overflow-y-auto">
							{locations.map((location, index) => (
								<div key={index} className="p-2 bg-zinc-50 rounded-md">
									<p className="font-medium text-foreground">{location.name}</p>
									<p className="text-muted-foreground text-xs">{formatAddress(location.address)}</p>
								</div>
							))}
						</div>
					)}

					{!hasMultipleLocations && locations[0] && (
						<div className="text-sm text-muted-foreground">
							<p className="font-medium text-foreground mb-1">{locations[0].name}</p>
							<p>{formatAddress(locations[0].address)}</p>
						</div>
					)}

					<div className="h-[300px] w-full rounded-lg overflow-hidden border">
						{loading ? (
							<div className="h-full w-full flex items-center justify-center bg-zinc-100">
								<Spinner className="w-8 h-8" />
							</div>
						) : error ? (
							<div className="h-full w-full flex items-center justify-center bg-zinc-100 text-muted-foreground text-sm">{error}</div>
						) : geocodedLocations.length > 0 ? (
							<MapContainer
								center={[geocodedLocations[0].lat, geocodedLocations[0].lon]}
								zoom={15}
								style={{ height: '100%', width: '100%' }}
								scrollWheelZoom={false}
							>
								<TileLayer
									attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
									url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
								/>
								{geocodedLocations.map((location, index) => (
									<Marker key={index} position={[location.lat, location.lon]}>
										<Popup>
											<div className="text-sm">
												<p className="font-medium">{location.name}</p>
												<p className="text-muted-foreground">{location.address}</p>
											</div>
										</Popup>
									</Marker>
								))}
								<MapBoundsUpdater locations={geocodedLocations} />
							</MapContainer>
						) : (
							<div className="h-full w-full flex items-center justify-center bg-zinc-100 text-muted-foreground text-sm">Loading map...</div>
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	)
}
