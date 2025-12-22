/**
 * Checks whether a URL is a valid Google Review link
 * using the official g.page format.
 *
 * Expected format:
 * https://g.page/r/{place-id}/review
 */
function isGPageReview(urlStr: string): boolean {
  try {
    const u = new URL(urlStr.trim());

    return (
      u.hostname.toLowerCase() === "g.page" &&
      u.pathname.startsWith("/r/") &&
      u.pathname.endsWith("/review")
    );
  } catch {
    return false;
  }
}
