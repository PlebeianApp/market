import { QRCodeSVG } from 'qrcode.react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface QRCodeProps {
	value: string
	size?: number
	className?: string
	includeMargin?: boolean
	level?: 'L' | 'M' | 'Q' | 'H'
	bgColor?: string
	fgColor?: string
	title?: string
	description?: string
	showBorder?: boolean
}

export function QRCode({
	value,
	size = 200,
	className,
	includeMargin = true,
	level = 'M',
	bgColor = '#ffffff',
	fgColor = '#000000',
	title,
	description,
	showBorder = true,
}: QRCodeProps) {
	if (!value) {
		return (
			<div className={cn('flex items-center justify-center bg-gray-100 rounded-lg', className)} style={{ width: size, height: size }}>
				<div className="text-center text-gray-500 text-sm">
					<div className="text-xs">No QR data</div>
				</div>
			</div>
		)
	}

	const qrCodeComponent = (
		<QRCodeSVG
			value={value}
			size={size}
			level={level}
			includeMargin={includeMargin}
			bgColor={bgColor}
			fgColor={fgColor}
			className="rounded-lg"
		/>
	)

	if (showBorder) {
		return (
			<Card className={cn('p-4 inline-block', className)}>
				<div className="text-center space-y-2">
					{title && <h3 className="font-medium text-sm">{title}</h3>}
					{qrCodeComponent}
					{description && <p className="text-xs text-gray-500 max-w-xs">{description}</p>}
				</div>
			</Card>
		)
	}

	return (
		<div className={cn('text-center space-y-2', className)}>
			{title && <h3 className="font-medium text-sm">{title}</h3>}
			{qrCodeComponent}
			{description && <p className="text-xs text-gray-500 max-w-xs">{description}</p>}
		</div>
	)
}
