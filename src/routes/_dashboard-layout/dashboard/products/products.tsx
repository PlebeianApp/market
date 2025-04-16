import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/products')({
  component: ProductsOverviewComponent,
})

function ProductsOverviewComponent() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Products Overview</h1>
      <p>Manage your products here</p>
    </div>
  )
} 