import { fetchProducts } from '@/queries/products'
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router'


export const Route = createFileRoute('/products')({
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureQueryData({
      queryKey: ['products'],
      queryFn: fetchProducts,
    }),
  component: RouteComponent,
})

function RouteComponent() {
    const productsQuery = useSuspenseQuery({
        queryKey: ['products'],
        queryFn: fetchProducts,
    })

    const products = productsQuery.data;

  return <div>
    <h1>Products</h1>
    {[...products].map((product) => (
        <div key={product.id}>
            <h2>{product.title}</h2>
            <p>{product.description}</p>
        </div>
    ))}
    </div>
}
