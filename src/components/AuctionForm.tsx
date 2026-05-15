import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface AuctionFormProps {
	startingBid: number
	onSubmit: (data: { reserve: number | null }) => void
}

export function AuctionForm({ startingBid, onSubmit }: AuctionFormProps) {
	const [useReserve, setUseReserve] = useState(false)
	const [reserve, setReserve] = useState<number | null>(null)

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault()
		onSubmit({
			reserve: useReserve ? reserve : null,
		})
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			<Button type="submit">Submit</Button>
		</form>
	)
}
