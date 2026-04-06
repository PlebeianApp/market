import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { ExternalLink, MapPin } from 'lucide-react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useCallback, useEffect, useRef, useState } from 'react'

interface PickupLocation {
	name: string
	mapLink: string
}

interface PickupLocationDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	locations: PickupLocation[]
	vendorName?: string
}

interface ParsedCoords {
	name: string
	mapLink: string
	lat: number
	lon: number
}

/** Extract lat/lon from a map link URL (supports btcmap.org/map#lat/lon and Google Maps formats) */
function parseCoordsFromLink(link: string): { lat: number; lon: number } | null {
	// #zoom/lat/lon — OpenStreetMap (#map=z/lat/lon) and BTC Map (#z/lat/lon)
	const zoomLatLonMatch = link.match(/#(?:map=)?\d+\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/)
	if (zoomLatLonMatch) {
		const lat = parseFloat(zoomLatLonMatch[1])
		const lon = parseFloat(zoomLatLonMatch[2])
		if (!isNaN(lat) && !isNaN(lon)) return { lat, lon }
	}

	// #lat/lon (2-segment hash, no zoom)
	const hashMatch = link.match(/#(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/)
	if (hashMatch) {
		const lat = parseFloat(hashMatch[1])
		const lon = parseFloat(hashMatch[2])
		if (!isNaN(lat) && !isNaN(lon)) return { lat, lon }
	}

	// Google Maps @lat,lon or ?q=lat,lon
	const atMatch = link.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)
	if (atMatch) {
		const lat = parseFloat(atMatch[1])
		const lon = parseFloat(atMatch[2])
		if (!isNaN(lat) && !isNaN(lon)) return { lat, lon }
	}

	const qMatch = link.match(/[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)
	if (qMatch) {
		const lat = parseFloat(qMatch[1])
		const lon = parseFloat(qMatch[2])
		if (!isNaN(lat) && !isNaN(lon)) return { lat, lon }
	}

	return null
}

export function PickupLocationDialog({ open, onOpenChange, locations, vendorName }: PickupLocationDialogProps) {
	const [parsedLocations, setParsedLocations] = useState<ParsedCoords[]>([])
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)
	const mapContainerRef = useRef<HTMLDivElement>(null)
	const mapRef = useRef<maplibregl.Map | null>(null)

	useEffect(() => {
		if (!open || locations.length === 0) return

		setLoading(true)
		setError(null)

		const results: ParsedCoords[] = []
		for (const location of locations) {
			const coords = parseCoordsFromLink(location.mapLink)
			if (coords) {
				results.push({ name: location.name, mapLink: location.mapLink, ...coords })
			}
		}

		if (results.length === 0) {
			setError('Could not parse coordinates from the map link')
		} else {
			setParsedLocations(results)
		}
		setLoading(false)
	}, [open, locations])

	const initMap = useCallback(() => {
		if (!mapContainerRef.current || parsedLocations.length === 0) return
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
			center: [parsedLocations[0].lon, parsedLocations[0].lat],
			zoom: 15,
			scrollZoom: false,
		})

		for (const location of parsedLocations) {
			const popup = new maplibregl.Popup({ offset: 25 }).setHTML(
				`<div style="font-size: 14px;"><p style="font-weight: 500; margin: 0 0 4px 0;">${location.name}</p></div>`,
			)

			new maplibregl.Marker().setLngLat([location.lon, location.lat]).setPopup(popup).addTo(map)
		}

		if (parsedLocations.length > 1) {
			const bounds = new maplibregl.LngLatBounds()
			for (const loc of parsedLocations) {
				bounds.extend([loc.lon, loc.lat])
			}
			map.fitBounds(bounds, { padding: 50 })
		}

		mapRef.current = map
	}, [parsedLocations])

	// Initialize map when parsed locations are ready
	useEffect(() => {
		if (parsedLocations.length > 0) {
			const id = requestAnimationFrame(initMap)
			return () => cancelAnimationFrame(id)
		}
	}, [parsedLocations, initMap])

	// Reset state when dialog closes
	useEffect(() => {
		if (!open) {
			if (mapRef.current) {
				mapRef.current.remove()
				mapRef.current = null
			}
			setParsedLocations([])
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
									<div className="flex items-center justify-between">
										<p className="font-medium text-foreground">{location.name}</p>
										<a
											href={location.mapLink}
											target="_blank"
											rel="noopener noreferrer"
											className="inline-flex items-center gap-1 text-orange-600 hover:text-orange-700 text-xs font-medium"
										>
											Open Map <ExternalLink className="w-3 h-3" />
										</a>
									</div>
								</div>
							))}
						</div>
					)}

					{!hasMultipleLocations && locations[0] && (
						<div className="text-sm text-muted-foreground">
							<div className="flex items-center justify-between mb-1">
								<p className="font-medium text-foreground">{locations[0].name}</p>
								<a
									href={locations[0].mapLink}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex items-center gap-1 text-orange-600 hover:text-orange-700 text-xs font-medium"
								>
									Open Map <ExternalLink className="w-3 h-3" />
								</a>
							</div>
						</div>
					)}

					<div className="h-[300px] w-full rounded-lg overflow-hidden border">
						{loading ? (
							<div className="h-full w-full flex items-center justify-center bg-zinc-100">
								<Spinner className="w-8 h-8" />
							</div>
						) : error ? (
							<div className="h-full w-full flex items-center justify-center bg-zinc-100 text-muted-foreground text-sm">{error}</div>
						) : parsedLocations.length > 0 ? (
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
