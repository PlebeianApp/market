import { Button } from '@/components/ui/button'
import type { ProductAuthoringStage, ProductAuthoringStageResolution } from '@/lib/workflow/productAuthoringStages'
import { CheckIcon } from 'lucide-react'

export function ProductAuthoringStageNavigator({
	resolution,
	onStageSelect,
}: {
	resolution: ProductAuthoringStageResolution
	onStageSelect: (stage: ProductAuthoringStage) => void
}) {
	return (
		<div className="flex flex-wrap gap-2" aria-label="Product authoring stages">
			{resolution.stages.map((stageState, index) => {
				const isAttentionStage = stageState.isFirstIncomplete && !stageState.isComplete

				return (
					<Button
						key={stageState.stage}
						type="button"
						variant={stageState.isSelected ? 'secondary' : 'outline'}
						className="h-auto flex-1 min-w-[8rem] justify-start gap-2 px-3 py-2 text-left normal-case"
						onClick={() => onStageSelect(stageState.stage)}
						disabled={!stageState.canSelect}
						aria-current={stageState.isSelected ? 'step' : undefined}
					>
						<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs">
							{stageState.isComplete ? <CheckIcon className="h-3.5 w-3.5" /> : index + 1}
						</span>
						<span className="flex min-w-0 flex-col">
							<span className="truncate text-xs font-semibold">{stageState.label}</span>
							{isAttentionStage ? <span className="text-[10px] text-red-600">Needs attention</span> : null}
						</span>
					</Button>
				)
			})}
		</div>
	)
}
