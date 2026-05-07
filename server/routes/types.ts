/**
 * Each route module exports a handler matching this shape. Returning `undefined`
 * means "I didn't handle this request" — the dispatcher then tries the next
 * module. Returning a `Response` (or a Promise of one) ends the chain.
 */
export type RouteHandler = (
  req: Request,
  url: URL,
) => Promise<Response | undefined> | Response | undefined;
