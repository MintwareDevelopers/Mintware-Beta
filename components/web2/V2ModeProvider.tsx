'use client'

import { createContext, useContext } from 'react'

// V1/V2 display mode, determined server-side (layout reads the unlock cookie) and injected here so
// client marketing pages + the Launch CTA can render V1-by-default / V2-when-unlocked without exposing
// the cookie to JS. `isV2` is true when the split is off (V2 everywhere) or the visitor unlocked V2.
const V2ModeContext = createContext<boolean>(true)

export function V2ModeProvider({ isV2, children }: { isV2: boolean; children: React.ReactNode }) {
  return <V2ModeContext.Provider value={isV2}>{children}</V2ModeContext.Provider>
}

/** true ⇒ show the V2 vision; false ⇒ show the V1 (live LP Gateway) experience. */
export function useV2Mode(): boolean {
  return useContext(V2ModeContext)
}
