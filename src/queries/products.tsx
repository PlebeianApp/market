export type ProductType = {
    id: number
    title: string
    description: string
}

const FAKE_PRODUCTS: ProductType[] = [
    {
        id: 1,
        title: 'Product 1',
        description: 'Description 1',
    },
    {
        id: 2,
        title: 'Product 2',
        description: 'Description 2',
    },
]

export const fetchProducts = async () => {
    console.info('Fetching products...')
    await new Promise((r) => setTimeout(r, 2000))
    return FAKE_PRODUCTS
  }

export const fetchProduct = async (id: number) => {
    console.info('Fetching product...')
    await new Promise((r) => setTimeout(r, 500))
    return FAKE_PRODUCTS.find((p) => p.id === id)
}