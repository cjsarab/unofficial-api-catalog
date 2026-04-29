/**
 * URL display helpers — convert wire-encoded URLs back into something a human
 * can read. Used in the Try panel URL bar and the Response panel.
 *
 * We deliberately decode only the query-parameter VALUES (the part after each
 * `=`), leaving structural characters (`?`, `&`, `=`, `/`) as-is. Running
 * `decodeURIComponent` on the whole URL would ambiguate the syntax — a
 * `%3F` inside a value would become a literal `?` and break parsing.
 */

export function decodeQueryValues(url: string): string {
  if (!url) return url;
  const qIdx = url.indexOf("?");
  if (qIdx === -1) return url;
  const base = url.slice(0, qIdx);
  const query = url.slice(qIdx + 1);

  const parts = query.split("&").map((part) => {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) return part;
    const key = part.slice(0, eqIdx);
    const value = part.slice(eqIdx + 1);
    return `${key}=${tryDecode(value)}`;
  });

  return `${base}?${parts.join("&")}`;
}

function tryDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    // Malformed escape — leave the value as-is rather than crashing the UI.
    return s;
  }
}

/**
 * Strip the protocol + host so we can show a tight `/api/…?…` form in the
 * compact response-panel header where horizontal space is at a premium.
 */
export function pathOnly(url: string): string {
  if (!url) return url;
  // Match `protocol://host/…` and keep just the trailing `/…`.
  const m = url.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]*(\/.*)$/i);
  return m ? m[1]! : url;
}
