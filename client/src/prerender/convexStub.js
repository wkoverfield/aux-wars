/**
 * Stand-in for convex/react while prerendering static pages at build time
 * (see entry.jsx). Queries report "loading" (undefined), exactly like the
 * app's first render before the Convex client connects. Mutations and
 * actions only run from event handlers and effects, which never fire during
 * a server render, so calling one is an error.
 */
const notAvailable = () => {
  throw new Error('Convex is not available while prerendering');
};

export const useQuery = () => undefined;
export const useMutation = () => notAvailable;
export const useAction = () => notAvailable;
export const useConvex = () => ({ query: notAvailable, mutation: notAvailable, action: notAvailable });
export const ConvexProvider = ({ children }) => children;
