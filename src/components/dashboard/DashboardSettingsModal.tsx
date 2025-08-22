import React from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useStore } from '@tanstack/react-store'
import { dashboardStore, dashboardActions } from '@/lib/stores/dashboard'

interface DraggableWidgetProps {
	widget: any
	index: number
	section: string
	onRemove: () => void
	onDragStart: (e: React.DragEvent, section: string, index: number) => void
	onDragOver: (e: React.DragEvent) => void
	onDrop: (e: React.DragEvent, section: string, index: number) => void
}

const DragIcon = () => (
	<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
		<line x1="8" y1="6" x2="21" y2="6" />
		<line x1="8" y1="12" x2="21" y2="12" />
		<line x1="8" y1="18" x2="21" y2="18" />
		<line x1="3" y1="6" x2="3.01" y2="6" />
		<line x1="3" y1="12" x2="3.01" y2="12" />
		<line x1="3" y1="18" x2="3.01" y2="18" />
	</svg>
)

const CloseIcon = () => (
	<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
		<line x1="18" y1="6" x2="6" y2="18" />
		<line x1="6" y1="6" x2="18" y2="18" />
	</svg>
)

const DraggableWidget: React.FC<DraggableWidgetProps> = ({ 
	widget, 
	index, 
	section, 
	onRemove, 
	onDragStart, 
	onDragOver, 
	onDrop 
}) => {
	return (
		<div
			draggable
			onDragStart={(e) => onDragStart(e, section, index)}
			onDragOver={onDragOver}
			onDrop={(e) => onDrop(e, section, index)}
			className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow cursor-move"
		>
			<div className="flex items-center gap-3">
				<div className="text-gray-400 hover:text-gray-600">
					<DragIcon />
				</div>
				<span className="font-medium text-gray-900">{widget.title}</span>
			</div>
			<button
				onClick={onRemove}
				className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
				title="Remove widget"
			>
				<CloseIcon />
			</button>
		</div>
	)
}

const SectionHeading: React.FC<{ title: string; description?: string }> = ({ title, description }) => (
	<div className="mb-3">
		<h3 className="text-lg font-semibold text-gray-900">{title}</h3>
		{description && <p className="text-sm text-gray-600">{description}</p>}
	</div>
)

const AddWidgetButton: React.FC<{ onAdd: (widget: any) => void }> = ({ onAdd }) => {
	const [showWidgetList, setShowWidgetList] = React.useState(false)
	
	const availableWidgets = [
		{ id: 'sales-overview', title: 'Sales Overview', description: 'Display sales data and trends' },
		{ id: 'top-products', title: 'Top Products', description: 'Show your latest products' },
		{ id: 'latest-messages', title: 'Latest Messages', description: 'Recent conversations' },
		{ id: 'nostr-posts', title: 'Nostr Posts', description: 'Latest posts from the network' },
		{ id: 'sales-chart', title: 'Sales Chart', description: 'Visual sales analytics' }
	]

	return (
		<>
			<Button 
				onClick={() => setShowWidgetList(true)}
				className="w-full bg-blue-600 hover:bg-blue-700 text-white"
			>
				+ Add Widget
			</Button>

			{showWidgetList && (
				<div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
					<div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 max-h-[80vh] overflow-y-auto">
						<div className="flex items-center justify-between mb-4">
							<h3 className="text-lg font-semibold">Select Widget to Add</h3>
							<button
								onClick={() => setShowWidgetList(false)}
								className="text-gray-400 hover:text-gray-600"
							>
								<CloseIcon />
							</button>
						</div>
						<div className="space-y-3">
							{availableWidgets.map((widget) => (
								<div
									key={widget.id}
									onClick={() => {
										onAdd(widget)
										setShowWidgetList(false)
									}}
									className="p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
								>
									<div className="font-medium text-gray-900">{widget.title}</div>
									<div className="text-sm text-gray-600">{widget.description}</div>
								</div>
							))}
						</div>
					</div>
				</div>
			)}
		</>
	)
}

export const DashboardSettingsModal: React.FC = () => {
	const dashboardState = useStore(dashboardStore)
	const { isOpen, widgets, layout } = dashboardState
	const [draggedWidget, setDraggedWidget] = React.useState<{ section: string; index: number } | null>(null)

	const handleDragStart = (e: React.DragEvent, section: string, index: number) => {
		setDraggedWidget({ section, index })
		e.dataTransfer.effectAllowed = 'move'
	}

	const handleDragOver = (e: React.DragEvent) => {
		e.preventDefault()
		e.dataTransfer.dropEffect = 'move'
	}

	const handleDrop = (e: React.DragEvent, destSection: string, destIndex: number) => {
		e.preventDefault()
		if (!draggedWidget) return

		const { section: sourceSection, index: sourceIndex } = draggedWidget
		dashboardActions.moveWidget(sourceSection, destSection, sourceIndex, destIndex)
		setDraggedWidget(null)
	}

	const handleAddWidget = (widget: any) => {
		// Add to hidden section first
		dashboardActions.addWidget(widget.id, 'hidden')
	}

	const handleRemoveWidget = (section: string, index: number) => {
		const widget = layout[section as keyof typeof layout]?.[index]
		if (widget) {
			dashboardActions.moveWidget(section, 'hidden', index, 0)
		}
	}

	const getSectionWidgets = (section: string) => {
		return layout[section as keyof typeof layout] || []
	}

	if (!isOpen) return null

	return (
		<Dialog open={isOpen} onOpenChange={() => dashboardActions.closeSettings()}>
			<DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0">
				{/* Fixed Header */}
				<DialogHeader className="px-6 py-4 border-b border-gray-200 flex-shrink-0">
					<DialogTitle className="text-xl font-semibold">Dashboard Widget Settings</DialogTitle>
				</DialogHeader>

				{/* Scrollable Content */}
				<div className="flex-1 overflow-y-auto px-6 py-4">
					<div className="space-y-6">
						{/* Top 2 columns */}
						<div>
							<SectionHeading 
								title="Top 2 columns" 
								description="Widgets span full width in top row"
							/>
							<div className="space-y-2">
								{getSectionWidgets('top').map((widget, index) => (
									<DraggableWidget
										key={`top-${index}`}
										widget={widget}
										index={index}
										section="top"
										onRemove={() => handleRemoveWidget('top', index)}
										onDragStart={handleDragStart}
										onDragOver={handleDragOver}
										onDrop={handleDrop}
									/>
								))}
							</div>
						</div>

						{/* Bottom 2 columns */}
						<div>
							<SectionHeading 
								title="Bottom 2 columns" 
								description="Widgets span full width in bottom row"
							/>
							<div className="space-y-2">
								{getSectionWidgets('bottom').map((widget, index) => (
									<DraggableWidget
										key={`bottom-${index}`}
										widget={widget}
										index={index}
										section="bottom"
										onRemove={() => handleRemoveWidget('bottom', index)}
										onDragStart={handleDragStart}
										onDragOver={handleDragOver}
										onDrop={handleDrop}
									/>
								))}
							</div>
						</div>

						{/* Right column */}
						<div>
							<SectionHeading 
								title="Right column" 
								description="Widgets in narrow right sidebar"
							/>
							<div className="space-y-2">
								{getSectionWidgets('right').map((widget, index) => (
									<DraggableWidget
										key={`right-${index}`}
										widget={widget}
										index={index}
										section="right"
										onRemove={() => handleRemoveWidget('right', index)}
										onDragStart={handleDragStart}
										onDragOver={handleDragOver}
										onDrop={handleDrop}
									/>
								))}
							</div>
						</div>

						{/* Hidden */}
						<div>
							<SectionHeading 
								title="Hidden" 
								description="Widgets not currently displayed"
							/>
							<div className="space-y-2">
								{getSectionWidgets('hidden').map((widget, index) => (
									<DraggableWidget
										key={`hidden-${index}`}
										widget={widget}
										index={index}
										section="hidden"
										onRemove={() => handleRemoveWidget('hidden', index)}
										onDragStart={handleDragStart}
										onDragOver={handleDragOver}
										onDrop={handleDrop}
									/>
								))}
							</div>
						</div>
					</div>
				</div>

				{/* Fixed Footer */}
				<div className="px-6 py-4 border-t border-gray-200 flex-shrink-0">
					<div className="flex items-center justify-between">
						<AddWidgetButton onAdd={handleAddWidget} />
						<Button
							onClick={() => dashboardActions.closeSettings()}
							variant="outline"
						>
							Done
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	)
}
