import React, { useState } from 'react'
import { useStore } from '@tanstack/react-store'
import { dashboardStore, dashboardActions, type DashboardWidget } from '@/lib/stores/dashboard'
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

// Drag handle icon (three lines)
function DragIcon({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
		>
			<line x1="3" y1="6" x2="21" y2="6" />
			<line x1="3" y1="12" x2="21" y2="12" />
			<line x1="3" y1="18" x2="21" y2="18" />
		</svg>
	)
}

// Close icon (X)
function CloseIcon({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
		>
			<line x1="18" y1="6" x2="6" y2="18" />
			<line x1="6" y1="6" x2="18" y2="18" />
		</svg>
	)
}

// Section heading component
function SectionHeading({ title, description }: { title: string; description?: string }) {
	return (
		<div className="bg-gray-100 px-4 py-3 border border-gray-200 rounded-lg">
			<h4 className="font-semibold text-gray-900">{title}</h4>
			{description && <p className="text-sm text-gray-600 mt-1">{description}</p>}
		</div>
	)
}

interface DraggableWidgetProps {
	widget: DashboardWidget
	onDragStart: (widget: DashboardWidget) => void
	onDragOver: (e: React.DragEvent) => void
	onDrop: (targetPosition: DashboardWidget['position']) => void
	position: DashboardWidget['position']
	onHide?: (widget: DashboardWidget) => void
}

function DraggableWidget({ widget, onDragStart, onDragOver, onDrop, position, onHide }: DraggableWidgetProps) {
	const handleDragStart = (e: React.DragEvent) => {
		onDragStart(widget)
	}

	const handleCloseClick = (e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		if (onHide) {
			onHide(widget)
		}
	}

	return (
		<Card
			draggable
			onDragStart={handleDragStart}
			onDragOver={onDragOver}
			onDrop={() => onDrop(position)}
			className="p-3 cursor-move border border-black bg-layer-elevated hover:bg-layer-overlay transition-colors group"
		>
			<div className="flex items-center gap-3">
				<DragIcon className="w-4 h-4 text-gray-500 flex-shrink-0" />
				<div className="flex-1 min-w-0">
					<h4 className="font-medium text-sm truncate">{widget.title}</h4>
					<p className="text-xs text-gray-600 truncate">{widget.description}</p>
				</div>
				{/* Close button - only show if onHide is provided (not for hidden widgets) */}
				{onHide && (
					<button
						onClick={handleCloseClick}
						className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
						aria-label={`Hide ${widget.title}`}
						title={`Hide ${widget.title}`}
					>
						<CloseIcon className="w-4 h-4" />
					</button>
				)}
			</div>
		</Card>
	)
}

// Drop zone component for empty sections
function DropZone({ position, onDrop, onDragOver }: { 
	position: DashboardWidget['position']
	onDrop: (position: DashboardWidget['position']) => void
	onDragOver: (e: React.DragEvent) => void
}) {
	return (
		<div
			onDrop={() => onDrop(position)}
			onDragOver={onDragOver}
			className="min-h-[60px] border-2 border-dashed border-gray-300 rounded-lg p-3 transition-colors hover:border-gray-400 hover:bg-gray-50 flex items-center justify-center"
		>
			<span className="text-gray-400 text-sm">Drop widget here</span>
		</div>
	)
}

export function DashboardSettingsModal() {
	const { isSettingsOpen, widgets, layout } = useStore(dashboardStore)
	const [draggedWidget, setDraggedWidget] = useState<DashboardWidget | null>(null)

	const handleDragStart = (widget: DashboardWidget) => {
		setDraggedWidget(widget)
	}

	const handleDragOver = (e: React.DragEvent) => {
		e.preventDefault()
	}

	const handleDrop = (position: DashboardWidget['position']) => {
		if (draggedWidget) {
			dashboardActions.moveWidget(draggedWidget.id, position)
			setDraggedWidget(null)
		}
	}

	const handleHideWidget = (widget: DashboardWidget) => {
		dashboardActions.moveWidget(widget.id, 'hidden')
	}

	// Get widgets organized by position
	const getWidgetByPosition = (position: keyof typeof layout) => {
		if (position === 'hidden') return null
		const widgetId = layout[position]
		return widgetId ? widgets.find(w => w.id === widgetId) || null : null
	}

	const hiddenWidgets = layout.hidden.map(id => widgets.find(w => w.id === id)).filter(Boolean) as DashboardWidget[]

	return (
		<Dialog open={isSettingsOpen} onOpenChange={dashboardActions.closeSettings}>
			<DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Customize Dashboard Layout</DialogTitle>
				</DialogHeader>

				<div className="space-y-6 mt-6">
					{/* Single column layout with sections */}
					<div className="space-y-4">
						{/* Top Row Section */}
						<SectionHeading title="Top Row" description="Two widgets side by side" />
						<div className="space-y-2 ml-4">
							{getWidgetByPosition('topLeft') ? (
								<DraggableWidget
									widget={getWidgetByPosition('topLeft')!}
									onDragStart={handleDragStart}
									onDragOver={handleDragOver}
									onDrop={handleDrop}
									position="top-left"
									onHide={handleHideWidget}
								/>
							) : (
								<DropZone position="top-left" onDrop={handleDrop} onDragOver={handleDragOver} />
							)}
							{getWidgetByPosition('topRight') ? (
								<DraggableWidget
									widget={getWidgetByPosition('topRight')!}
									onDragStart={handleDragStart}
									onDragOver={handleDragOver}
									onDrop={handleDrop}
									position="top-right"
									onHide={handleHideWidget}
								/>
							) : (
								<DropZone position="top-right" onDrop={handleDrop} onDragOver={handleDragOver} />
							)}
						</div>

						{/* Bottom Row Section */}
						<SectionHeading title="Bottom Row" description="Two widgets side by side" />
						<div className="space-y-2 ml-4">
							{getWidgetByPosition('bottomLeft') ? (
								<DraggableWidget
									widget={getWidgetByPosition('bottomLeft')!}
									onDragStart={handleDragStart}
									onDragOver={handleDragOver}
									onDrop={handleDrop}
									position="bottom-left"
									onHide={handleHideWidget}
								/>
							) : (
								<DropZone position="bottom-left" onDrop={handleDrop} onDragOver={handleDragOver} />
							)}
							{getWidgetByPosition('bottomRight') ? (
								<DraggableWidget
									widget={getWidgetByPosition('bottomRight')!}
									onDragStart={handleDragStart}
									onDragOver={handleDragOver}
									onDrop={handleDrop}
									position="bottom-right"
									onHide={handleHideWidget}
								/>
							) : (
								<DropZone position="bottom-right" onDrop={handleDrop} onDragOver={handleDragOver} />
							)}
						</div>

						{/* Right Column Section */}
						<SectionHeading title="Right Column" description="Full height widget" />
						<div className="ml-4">
							{getWidgetByPosition('right') ? (
								<DraggableWidget
									widget={getWidgetByPosition('right')!}
									onDragStart={handleDragStart}
									onDragOver={handleDragOver}
									onDrop={handleDrop}
									position="right"
									onHide={handleHideWidget}
								/>
							) : (
								<DropZone position="right" onDrop={handleDrop} onDragOver={handleDragOver} />
							)}
						</div>

						{/* Hidden Widgets Section */}
						<SectionHeading title="Available Widgets" description="Drag from here to position above" />
						<div className="space-y-2 ml-4">
							{hiddenWidgets.map((widget) => (
								<DraggableWidget
									key={widget.id}
									widget={widget}
									onDragStart={handleDragStart}
									onDragOver={handleDragOver}
									onDrop={handleDrop}
									position="hidden"
									// Don't pass onHide for hidden widgets - they can't be hidden again
								/>
							))}
							{hiddenWidgets.length === 0 && (
								<div className="text-center text-gray-500 text-sm py-4 border border-dashed border-gray-300 rounded-lg">
									All widgets are in use
								</div>
							)}
						</div>
					</div>
				</div>

				{/* Actions */}
				<div className="flex justify-between pt-6 border-t mt-6">
					<Button
						onClick={dashboardActions.resetToDefaults}
						variant="outline"
					>
						Reset to Defaults
					</Button>
					<div className="space-x-2">
						<Button
							onClick={dashboardActions.closeSettings}
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							onClick={dashboardActions.closeSettings}
						>
							Save Changes
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	)
}
