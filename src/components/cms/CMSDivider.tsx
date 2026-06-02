import React from 'react'

export interface CMSDividerProps {
	className?: string
}

export const CMSDivider: React.FC<CMSDividerProps> = ({ className = '' }) => {
	return (
		<div className={`py-8 ${className}`}>
			<div className="w-full h-px bg-muted"></div>
		</div>
	)
}
