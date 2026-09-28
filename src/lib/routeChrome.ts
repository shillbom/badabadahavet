/**
 * Which parts of the app chrome a route shows, and how wide its content
 * column is — the pure half of src/components/Layout.tsx, kept out of the
 * component so the per-route rules read as a table and can be tested.
 */

export type RouteChrome = {
  /** The map fills the viewport and doesn't scroll. */
  isMapPage: boolean;
  /** Full-screen story-style routes (recap) and the swim log/edit forms
   *  hide the bottom nav + FAB so they don't fight the slide content or sit
   *  on top of submit buttons. */
  hideChrome: boolean;
  /** hideChrome, plus a guest on a spot page (typically arriving from search
   *  or a shared link): the nav's tabs lead guests to empty screens or
   *  sign-in walls, and the top bar already offers sign-in. */
  hideNav: boolean;
  /** Desktop width of the content column. The top bar always spans the full
   *  viewport; the map gets all of it, recap stays phone-shaped, everything
   *  else widens to a comfortable reading column. */
  contentWidth: string;
};

export function routeChrome(pathname: string, isGuest: boolean): RouteChrome {
  const isMapPage = pathname === "/";
  const isRecap = pathname.startsWith("/recap");
  const hideChrome =
    isRecap || pathname.startsWith("/log") || pathname.startsWith("/swim/");
  const hideNav = hideChrome || (isGuest && pathname.startsWith("/spot/"));

  let contentWidth = "max-w-md lg:max-w-2xl";
  if (isMapPage) contentWidth = "max-w-md lg:max-w-none";
  else if (isRecap) contentWidth = "max-w-md";

  return { isMapPage, hideChrome, hideNav, contentWidth };
}
