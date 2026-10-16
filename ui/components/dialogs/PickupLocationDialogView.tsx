import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../primitives/dialog'
import { Spinner } from '../../primitives/spinner'
import { MapPin } from 'lucide-react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useCallback, useEffect, useRef } from 'react'

export interface PickupLocationSummary {
	name: string
	/** Single-line formatted address. */
	address: string
}

export interface GeocodedPickupLocation extends PickupLocationSummary {
	lat: number
	lon: number
}

export interface PickupLocationDialogViewProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	locations: readonly PickupLocationSummary[]
	geocodedLocations: readonly GeocodedPickupLocation[]
	loading: boolean
	error: string | null
	vendorName?: string
}

// Names and addresses come from relay data, so popups are built as text nodes, never HTML.
function createPopupContent(location: PickupLocationSummary): HTMLElement {
	const root = document.createElement('div')
	root.style.fontSize = '14px'
	const name = document.createElement('p')
	name.style.cssText = 'font-weight: 500; margin: 0 0 4px 0;'
	name.textContent = location.name
	const address = document.createElement('p')
	address.style.cssText = 'margin: 0; color: #71717a;'
	address.textContent = location.address
	root.append(name, address)
	return root
}

export function PickupLocationDialogView({
	open,
	onOpenChange,
	locations,
	geocodedLocations,
	loading,
	error,
	vendorName,
}: PickupLocationDialogViewProps) {
	const mapContainerRef = useRef<HTMLDivElement>(null)
	const mapRef = useRef<maplibregl.Map | null>(null)

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
			const popup = new maplibregl.Popup({ offset: 25 }).setDOMContent(createPopupContent(location))

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

	// Tear down the map when the dialog closes.
	useEffect(() => {
		if (!open && mapRef.current) {
			mapRef.current.remove()
			mapRef.current = null
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
									<p className="text-muted-foreground text-xs">{location.address}</p>
								</div>
							))}
						</div>
					)}

					{!hasMultipleLocations && locations[0] && (
						<div className="text-sm text-muted-foreground">
							<p className="font-medium text-foreground mb-1">{locations[0].name}</p>
							<p>{locations[0].address}</p>
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
