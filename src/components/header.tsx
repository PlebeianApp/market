import { Link } from '@tanstack/react-router'
import { useConfigQuery } from '@/queries/config'

export function Header() {
  const { data: config } = useConfigQuery()

  return (
    <header className="sticky top-0 z-30 bg-black py-4 text-white px-4">
      <div className="container flex h-full max-w-full items-center justify-between">
        <section className="inline-flex items-center">
          <Link to="/">
            <div className="flex items-center">
              {config?.appSettings?.picture && (
                <img src={config.appSettings.picture} alt={config.appSettings.displayName} className="w-16 px-2" />
              )}
              <span className="hidden lg:block lg:text-2xl">{config?.appSettings?.displayName || 'Market'}</span>
            </div>
          </Link>
          <div className="hidden sm:flex mx-8 gap-8">
            <Link to="/products" className="hover:text-secondary">
              Products
            </Link>
            <Link to="/community" className="hover:text-secondary">
              Community
            </Link>
            <Link to="/nostr" className="hover:text-secondary">
              Nostr
            </Link>
          </div>
        </section>
        <div className="flex items-center gap-2 lg:gap-4">
          <div className="hidden lg:block flex-1">
            {/* ProductSearch component will go here */}
          </div>
          <div className="flex gap-2">
            {/* Cart component will go here */}
          </div>
          <button className="sm:flex p-2 relative rounded-md hover:text-secondary">
            <span className="i-tdesign-user-1 w-6 h-6" />
          </button>
        </div>
      </div>
    </header>
  )
} 