import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/community/')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/community/"!</div>
}
