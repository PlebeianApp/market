import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

interface Props {
	children: ReactNode
}

interface State {
	hasError: boolean
	error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
	constructor(props: Props) {
		super(props)
		this.state = { hasError: false, error: null }
	}

	static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error }
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error('ErrorBoundary caught:', error, info.componentStack)
	}

	render() {
		if (this.state.hasError) {
			return (
				<div className="flex h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
					<h1 className="text-2xl font-bold">Something went wrong</h1>
					<p className="text-gray-600 max-w-md">{this.state.error?.message || 'An unexpected error occurred.'}</p>
					<div className="flex gap-2">
						<Button
							variant="secondary"
							onClick={() => {
								this.setState({ hasError: false, error: null })
								window.location.reload()
							}}
						>
							Reload page
						</Button>
						<Button variant="outline" onClick={() => (window.location.href = '/')}>
							Go home
						</Button>
					</div>
				</div>
			)
		}

		return this.props.children
	}
}
