// Client-side helpers for SDKAuthConfig. These are a deterrent, not a security boundary —
// anything enforced in the browser can be bypassed, so real protection belongs on the server.

/**
 * True when `hostname` matches one of the allowed patterns:
 * - exact host: "example.com"
 * - wildcard:   "*.example.com" (matches the apex and any subdomain)
 * - "*"         (anything)
 * Patterns may include a protocol or port; both are ignored.
 */
export function isDomainAllowed(hostname: string, patterns: string[]): boolean {
  const host = hostname.toLowerCase();

  return patterns.some(raw => {
    const pattern = raw
      .trim()
      .toLowerCase()
      .replace(/^[a-z]+:\/\//, '')
      .replace(/[/:].*$/, '');

    if (!pattern) return false;
    if (pattern === '*') return true;
    if (pattern.startsWith('*.')) {
      const apex = pattern.slice(2);
      return host === apex || host.endsWith(`.${apex}`);
    }
    return host === pattern;
  });
}
