// Guards against javascript:/data:/vbscript: URL XSS when rendering untrusted (user/agent/
// campaign-supplied) links into an href. Returns the URL only when it's a well-formed http(s)
// external URL; otherwise undefined, so the anchor renders inert instead of executing script.
export function safeUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  try {
    const u = new URL(String(url).trim())
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined
  } catch {
    return undefined
  }
}
