import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { MapPin } from 'lucide-react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useCallback, useEffect, useRef, useState } from 'react'

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

function formatAddress(address: PickupAddress): string {
	return [address.street, address.city, address.state, address.postalCode, address.country].filter(Boolean).join(', ')
}

export function PickupLocationDialog({ open, onOpenChange, locations, vendorName }: PickupLocationDialogProps) {
	const [geocodedLocations, setGeocodedLocations] = useState<GeocodedLocation[]>([])
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const mapContainerRef = useRef<HTMLDivElement>(null)
	const mapRef = useRef<maplibregl.Map | null>(null)

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

	const initMap = useCallback(() => {
		if (!mapContainerRef.current || geocodedLocations.length === 0) return
		if (mapRef.current) {
			mapRef.current.remove()
			mapRef.current = null
		}

		const map = new maplibregl.Map({
			container: mapContainerRef.current,
			style: {
				version: 8,
				sources: {
					osm: {
						type: 'raster',
						tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
						tileSize: 256,
						attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
					},
				},
				layers: [
					{
						id: 'osm',
						type: 'raster',
						source: 'osm',
					},
				],
			},
			center: [geocodedLocations[0].lon, geocodedLocations[0].lat],
			zoom: 15,
			scrollZoom: false,
		})

		for (const location of geocodedLocations) {
			const popup = new maplibregl.Popup({ offset: 25 }).setHTML(
				`<div style="font-size: 14px;"><p style="font-weight: 500; margin: 0 0 4px 0;">${location.name}</p><p style="margin: 0; color: #71717a;">${location.address}</p></div>`,
			)

			new maplibregl.Marker().setLngLat([location.lon, location.lat]).setPopup(popup).addTo(map)
		}

		if (geocodedLocations.length > 1) {
			const bounds = new maplibregl.LngLatBounds()
			for (const loc of geocodedLocations) {
				bounds.extend([loc.lon, loc.lat])
			}
			map.fitBounds(bounds, { padding: 50 })
		}

		mapRef.current = map
	}, [geocodedLocations])

	// Initialize map when geocoded locations are ready and container is mounted
	useEffect(() => {
		if (geocodedLocations.length > 0) {
			// Small delay to ensure the container is rendered in the DOM
			const id = requestAnimationFrame(initMap)
			return () => cancelAnimationFrame(id)
		}
	}, [geocodedLocations, initMap])

	// Reset state when dialog closes
	useEffect(() => {
		if (!open) {
			if (mapRef.current) {
				mapRef.current.remove()
				mapRef.current = null
			}
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
							<div ref={mapContainerRef} style={{ height: '100%', width: '100%' }} />
						) : (
							<div className="h-full w-full flex items-center justify-center bg-zinc-100 text-muted-foreground text-sm">Loading map...</div>
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	)
}
