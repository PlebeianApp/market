import React from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useStore } from '@tanstack/react-store'
import { dashboardStore, dashboardActions } from '@/lib/stores/dashboard'
import { useBreakpoint } from '@/hooks/useBreakpoint'

interface DraggableWidgetProps {
	widget: any
	index: number
	section: string
	onRemove: () => void
	onDragStart: (e: React.DragEvent, section: string, index: number) => void
	onDragOver: (e: React.DragEvent) => void
	onDrop: (e: React.DragEvent, section: string, index: number) => void
	showRemove?: boolean
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
	onDrop, 
	showRemove = true
}) => {
	return (
		<div
			draggable
			onDragStart={(e) => onDragStart(e, section, index)}
			onDragOver={onDragOver}
			onDrop={(e) => onDrop(e, section, index)}
			className="flex items-center justify-between p-3 bg-white border border-black rounded-lg shadow-sm hover:shadow-md transition-shadow cursor-move"
		>
			<div className="flex items-center gap-3 min-w-0">
				<span className="font-medium text-gray-900 truncate">{widget.title}</span>
			</div>
			<div className="flex items-center gap-2">
				{showRemove && (
					<button
						onClick={onRemove}
						className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
						title="Hide widget"
					>
						<CloseIcon />
					</button>
				)}
				<div className="text-gray-400 hover:text-gray-700 cursor-grab">
					<DragIcon />
				</div>
			</div>
		</div>
	)
}

const SectionHeading: React.FC<{ title: string; description?: string }> = ({ title, description }) => (
	<div className="mb-3">
		<h3 className="text-lg font-semibold text-gray-900">{title}</h3>
		{description && <p className="text-sm text-gray-600">{description}</p>}
	</div>
)

const DropSlot: React.FC<{
	section: string
	index: number
	onDragOver: (e: React.DragEvent) => void
	onDrop: (e: React.DragEvent, section: string, index: number) => void
}> = ({ section, index, onDragOver, onDrop }) => (
	<div
		onDragOver={onDragOver}
		onDrop={(e) => onDrop(e, section, index)}
		className="h-10 rounded-lg border-2 border-dashed border-black bg-white text-xs text-gray-500 flex items-center justify-center"
	>
		Drop here
	</div>
)

export const DashboardSettingsModal: React.FC = () => {
	const dashboardState = useStore(dashboardStore)
	const { isOpen, layout } = dashboardState
	const [draggedWidget, setDraggedWidget] = React.useState<{ section: string; index: number } | null>(null)
	const [initialLayout, setInitialLayout] = React.useState(layout)
	const breakpoint = useBreakpoint()
	const isMobile = breakpoint === 'sm' || breakpoint === 'md' || breakpoint === 'lg'

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

	const handleRemoveWidget = (section: string, index: number) => {
		const widget = layout[section as keyof typeof layout]?.[index]
		if (widget) {
			dashboardActions.moveWidget(section, 'hidden', index, 0)
		}
	}

	const getSectionWidgets = (section: string) => layout[section as keyof typeof layout] || []

	React.useEffect(() => {
		if (isOpen) setInitialLayout(layout)
	}, [isOpen])

	if (!isOpen) return null

	return (
		<Dialog open={isOpen} onOpenChange={() => dashboardActions.closeSettings()}>
			<DialogContent className="max-w-2xl w-[95vw] max-h-[90vh] flex flex-col p-0 overflow-hidden [&>button]:top-4 [&>button]:right-4">
				{/* Fixed Header */}
				<DialogHeader className="px-6 py-4 border-b border-black flex-shrink-0 bg-white">
					<DialogTitle className="font-semibold font-heading text-[16px] sm:text-lg">Dashboard Layout</DialogTitle>
				</DialogHeader>

				{/* Scrollable Content */}
				<div className="flex-1 overflow-y-auto px-6 py-4 bg-white">
					<div className="space-y-6">
						{/* Global instruction heading */}
						<SectionHeading title="Top to bottom" />
						{/* Top 2 columns */}
						<div>
							{!isMobile && <SectionHeading title="Top 2 columns" />}
							<div className="space-y-2">
								{getSectionWidgets('top').length === 0 ? (
									<DropSlot section="top" index={0} onDragOver={handleDragOver} onDrop={handleDrop} />
								) : (
									<>
										{getSectionWidgets('top').map((widget, index) => (
											<DraggableWidget
												key={`top-${index}`}
												widget={dashboardActions.getWidgetById(widget)}
												index={index}
												section="top"
												onRemove={() => handleRemoveWidget('top', index)}
												onDragStart={handleDragStart}
												onDragOver={handleDragOver}
												onDrop={handleDrop}
											/>
										))}
										{getSectionWidgets('top').length < 2 && (
											<DropSlot section="top" index={getSectionWidgets('top').length} onDragOver={handleDragOver} onDrop={handleDrop} />
										)}
									</>
								)}
							</div>
						</div>

						{/* Bottom 2 columns */}
						<div>
							{!isMobile && <SectionHeading title="Bottom 2 columns" />}
							<div className="space-y-2">
								{getSectionWidgets('bottom').length === 0 ? (
									<DropSlot section="bottom" index={0} onDragOver={handleDragOver} onDrop={handleDrop} />
								) : (
									<>
										{getSectionWidgets('bottom').map((widget, index) => (
											<DraggableWidget
												key={`bottom-${index}`}
												widget={dashboardActions.getWidgetById(widget)}
												index={index}
												section="bottom"
												onRemove={() => handleRemoveWidget('bottom', index)}
												onDragStart={handleDragStart}
												onDragOver={handleDragOver}
												onDrop={handleDrop}
											/>
										))}
										{getSectionWidgets('bottom').length < 2 && (
											<DropSlot section="bottom" index={getSectionWidgets('bottom').length} onDragOver={handleDragOver} onDrop={handleDrop} />
										)}
									</>
								)}
							</div>
						</div>

						{/* Right column */}
						<div>
							{!isMobile && <SectionHeading title="Right column" />}
							<div className="space-y-2">
								{getSectionWidgets('right').length === 0 ? (
									<DropSlot section="right" index={0} onDragOver={handleDragOver} onDrop={handleDrop} />
								) : (
									<>
										{getSectionWidgets('right').map((widget, index) => (
											<DraggableWidget
												key={`right-${index}`}
												widget={dashboardActions.getWidgetById(widget)}
												index={index}
												section="right"
												onRemove={() => handleRemoveWidget('right', index)}
												onDragStart={handleDragStart}
												onDragOver={handleDragOver}
												onDrop={handleDrop}
											/>
										))}
										<DropSlot section="right" index={getSectionWidgets('right').length} onDragOver={handleDragOver} onDrop={handleDrop} />
									</>
								)}
							</div>
						</div>

						{/* Hidden */}
						<div>
							{!isMobile && <SectionHeading title="Hidden" />}
							<div className="space-y-2">
								{getSectionWidgets('hidden').length === 0 ? (
									<DropSlot section="hidden" index={0} onDragOver={handleDragOver} onDrop={handleDrop} />
								) : (
									<>
										{getSectionWidgets('hidden').map((widget, index) => (
											<DraggableWidget
												key={`hidden-${index}`}
												widget={dashboardActions.getWidgetById(widget)}
												index={index}
												section="hidden"
												onRemove={() => handleRemoveWidget('hidden', index)}
												onDragStart={handleDragStart}
												onDragOver={handleDragOver}
												onDrop={handleDrop}
												showRemove={false}
											/>
										))}
										<DropSlot section="hidden" index={getSectionWidgets('hidden').length} onDragOver={handleDragOver} onDrop={handleDrop} />
									</>
								)}
							</div>
						</div>
					</div>
				</div>

				{/* Fixed Footer */}
				<div className="px-6 py-4 border-t border-black flex-shrink-0 bg-white">
					<div className="flex items-center justify-between">
						<div>
							<Button
								variant="outline"
								className="btn-black"
								onClick={() => {
									dashboardActions.replaceLayout(initialLayout)
									dashboardActions.closeSettings()
								}}
							>
								Cancel
							</Button>
						</div>
						<div className="flex items-center gap-2">
							<Button onClick={dashboardActions.resetToDefaults} variant="outline" className="btn-black">Reset</Button>
							<Button onClick={() => dashboardActions.closeSettings()} variant="outline" className="btn-black">Done</Button>
						</div>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	)
}
