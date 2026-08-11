'use client'

// RevealObserver — a single global IntersectionObserver that reveals any element
// carrying `.mw-reveal` as it scrolls into view (adds `.mw-in`, then unobserves).
// A MutationObserver picks up nodes added by client-rendered pages / route changes,
// so it works across the whole app from one mount. Reduced-motion → reveal all now.

import { useEffect } from 'react'

export function RevealObserver() {
  useEffect(() => {
    if (typeof window === 'undefined') return

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.querySelectorAll('.mw-reveal').forEach((el) => el.classList.add('mw-in'))
      return
    }

    const observed = new WeakSet<Element>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('mw-in')
            io.unobserve(e.target)
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    )

    const inViewport = (el: Element) => {
      const r = el.getBoundingClientRect()
      return r.top < window.innerHeight && r.bottom > 0
    }
    const scan = () => {
      document.querySelectorAll('.mw-reveal:not(.mw-in)').forEach((el) => {
        // Anything already on screen reveals immediately (no wait on the IO tick);
        // everything below the fold is observed and reveals as it scrolls in.
        if (inViewport(el)) {
          el.classList.add('mw-in')
          return
        }
        if (!observed.has(el)) {
          observed.add(el)
          io.observe(el)
        }
      })
    }

    scan()
    const mo = new MutationObserver(scan)
    mo.observe(document.body, { childList: true, subtree: true })

    return () => {
      io.disconnect()
      mo.disconnect()
    }
  }, [])

  return null
}
