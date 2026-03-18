// instrumentation.ts — Next.js server instrumentation hook
//
// Runs once at server startup, before any module initialization.
//
// Purpose: WalletConnect's idb-keyval dependency calls `indexedDB.open()`
// at module load time. Node.js has no IndexedDB API, so this throws
// `ReferenceError: indexedDB is not defined` as an unhandledRejection.
//
// Fix: stub `globalThis.indexedDB` with a permanently-pending open() call.
// idb-keyval wraps the request in a Promise via addEventListener('success'/'error').
// Since we never fire either event, the Promise hangs until GC — safe for
// ephemeral SSR requests. No rejection, no secondary errors.
//
// wagmi uses cookieStorage for its own SSR state hydration, so no wallet
// state data passes through this code path at all.

export async function register() {
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    typeof (globalThis as Record<string, unknown>).indexedDB === 'undefined'
  ) {
    const noop = () => {}
    const noopReq = () => ({
      result: null,
      error: null,
      source: null,
      transaction: null,
      readyState: 'pending' as IDBRequestReadyState,
      onerror: null,
      onsuccess: null,
      onupgradeneeded: null,
      onblocked: null,
      addEventListener: noop,
      removeEventListener: noop,
      dispatchEvent: () => false,
    })

    ;(globalThis as Record<string, unknown>).indexedDB = {
      open: (_name: string, _version?: number) =>
        noopReq() as unknown as IDBOpenDBRequest,
      deleteDatabase: (_name: string) =>
        noopReq() as unknown as IDBOpenDBRequest,
      cmp: () => 0,
      databases: async () => [],
    } satisfies IDBFactory
  }
}
