// Where Threadsium is served for everyone else. Snippets other projects copy point here, even when the page that shows
// them runs on localhost or a preview host, so a copied embed never points at a developer's machine.
export const PUBLIC_ORIGIN = "https://threadsium.app";

/** The origin to put in copyable snippets: this page's own when it is a real deployment, otherwise PUBLIC_ORIGIN. */
export function snippetOrigin(): string {
  const loc = (globalThis as { location?: { hostname: string; origin: string } }).location;
  if (!loc) return PUBLIC_ORIGIN;
  const { hostname, origin } = loc;
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".localhost");
  return local ? PUBLIC_ORIGIN : origin;
}
