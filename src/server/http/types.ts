/**
 * Bun's `serve({ routes })` accepts a record where each value is either
 * a fetch-style handler, a Response, or a method-keyed object. We keep
 * the shape duck-typed and let module authors export plain records that
 * compose with `Object.assign(...)` in `buildServer.ts`.
 *
 * Route values may be:
 *   - a `(req: Request) => Response | Promise<Response>` function
 *   - an object keyed by HTTP method (`GET`, `POST`, ...) of such fns
 *   - a `Response` (e.g. SPA index.html short-circuit)
 *
 * We intentionally don't tighten this further — Bun matches the shape
 * structurally, so being too strict here would just create false typecheck
 * pain when handlers receive `Bun.RouterTypes.RouteParams` or similar.
 */
type BunRouteHandler = (req: Request & { params?: Record<string, string> }) => Response | Promise<Response>
type BunRouteMethodObject = {
	[method in 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE']?: BunRouteHandler
}

/**
 * Route values our domain modules emit. Bun's `serve({ routes })` also
 * accepts a few extra shapes (`HTMLBundle` for the SPA catch-all,
 * `BunFile`, etc.) — those are passed through `buildServer.ts` with a
 * targeted `as` cast so we don't have to widen this union to `unknown`
 * (which would re-introduce implicit-any in the handler signatures).
 */
export type BunRouteValue = BunRouteHandler | Response | BunRouteMethodObject

export type BunRoutes = Record<string, BunRouteValue>
