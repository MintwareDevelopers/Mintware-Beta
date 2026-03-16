/**
 * mw-auth.js — Mintware shared wallet + nav module
 * Include on every page: <script src="/mw-auth.js"></script>
 *
 * Usage:
 *   MW.renderNav({ active: 'dashboard' })   // render nav into <nav id="mw-nav">
 *   MW.requireWallet()                       // redirects to / if no wallet; returns address
 *   MW.getWallet()                           // returns address or null (no redirect)
 *   MW.connectWallet()                       // MetaMask prompt → stores → returns address
 *   MW.disconnectWallet()                    // clears storage → redirects to /
 */
(function () {
  'use strict';

  const WALLET_KEY = 'mw_wallet';
  const API = 'https://attribution-scorer.ceo-1f9.workers.dev';

  // ── Storage ─────────────────────────────────────────────────────────────────
  function getWallet() {
    return localStorage.getItem(WALLET_KEY) || null;
  }

  function setWallet(addr) {
    localStorage.setItem(WALLET_KEY, addr.toLowerCase());
  }

  // ── Provider resolution (handles MetaMask + Coinbase Wallet conflict) ────────
  // When multiple wallet extensions are installed, window.ethereum becomes a
  // Proxy that can cause private-field errors. Resolve the real provider first.
  function getProvider() {
    if (!window.ethereum) return null;
    // EIP-6963 / multi-provider: pick MetaMask if available, else first provider
    const providers = window.ethereum.providers;
    if (Array.isArray(providers) && providers.length > 0) {
      return providers.find(function (p) {
        try { return p.isMetaMask && !p.isCoinbaseWallet; } catch (e) { return false; }
      }) || providers[0];
    }
    return window.ethereum;
  }

  // ── Connect ──────────────────────────────────────────────────────────────────
  async function connectWallet() {
    const provider = getProvider();
    if (!provider) {
      alert('No wallet found — please install MetaMask to continue.');
      return null;
    }
    try {
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      const addr = accounts[0].toLowerCase();
      setWallet(addr);
      return addr;
    } catch (e) {
      if (e.code === 4001) return null; // user rejected
      console.error('[MW] connect error', e);
      return null;
    }
  }

  // ── Disconnect ───────────────────────────────────────────────────────────────
  function disconnectWallet() {
    localStorage.removeItem(WALLET_KEY);
    window.location.href = '/';
  }

  // ── Auth guard ───────────────────────────────────────────────────────────────
  // Call at top of every protected page. Redirects synchronously if no wallet.
  function requireWallet() {
    const w = getWallet();
    if (!w) {
      window.location.replace('/');
      return null;
    }
    return w;
  }

  // ── Nav styles (injected once) ────────────────────────────────────────────────
  function injectNavStyles() {
    if (document.getElementById('mw-nav-css')) return;
    const s = document.createElement('style');
    s.id = 'mw-nav-css';
    s.textContent = `
      #mw-nav {
        position: sticky; top: 0; z-index: 200;
        display: flex; align-items: center; justify-content: space-between;
        padding: 16px 48px;
        background: rgba(255,255,255,0.94);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        border-bottom: 1px solid rgba(26,26,46,0.08);
        font-family: 'Plus Jakarta Sans', sans-serif;
      }
      .mw-logo {
        font-family: Georgia, serif;
        font-size: 18px; font-weight: 700; letter-spacing: -0.5px;
        text-decoration: none; color: #1A1A2E; flex-shrink: 0;
      }
      .mw-logo em { font-style: normal; color: #0052FF; }
      .mw-nav-right {
        display: flex; align-items: center; gap: 24px;
      }
      .mw-nav-link {
        font-size: 13px; font-weight: 500; color: #8A8C9E;
        text-decoration: none; transition: color 0.15s; white-space: nowrap;
      }
      .mw-nav-link:hover { color: #1A1A2E; }
      .mw-nav-link.active { color: #0052FF; font-weight: 600; }
      .mw-connect-btn {
        padding: 8px 20px; border-radius: 10px;
        background: #0052FF; color: #fff; border: none;
        font-size: 13px; font-weight: 600; cursor: pointer;
        font-family: 'Plus Jakarta Sans', sans-serif;
        transition: background 0.15s, transform 0.15s;
        white-space: nowrap;
      }
      .mw-connect-btn:hover { background: #0040cc; transform: translateY(-1px); }
      .mw-wallet-pill {
        display: flex; align-items: center; gap: 8px;
        padding: 7px 14px; border-radius: 20px;
        background: #F7F6FF; border: 1px solid rgba(26,26,46,0.13);
        font-family: 'DM Mono', monospace; font-size: 12px; color: #8A8C9E;
        cursor: pointer; transition: border-color 0.15s, color 0.15s;
        user-select: none; white-space: nowrap;
      }
      .mw-wallet-pill:hover { border-color: #ef4444; color: #dc2626; }
      .mw-wallet-pill:hover .mw-wallet-dot { background: #ef4444; animation: none; }
      .mw-wallet-dot {
        width: 6px; height: 6px; border-radius: 50%;
        background: #16a34a; flex-shrink: 0;
        animation: mw-pulse 2s ease infinite;
      }
      .mw-wallet-x { font-size: 13px; opacity: 0.45; margin-left: 1px; }
      @keyframes mw-pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
      @media (max-width: 640px) {
        #mw-nav { padding: 14px 20px; }
        .mw-nav-right { gap: 14px; }
        .mw-nav-link:not(.mw-always-show) { display: none; }
      }
    `;
    document.head.insertBefore(s, document.head.firstChild);
  }

  // ── Render nav ────────────────────────────────────────────────────────────────
  // opts.active: 'dashboard' | 'leaderboard' | 'explorer' | ''
  // opts.onConnect: async fn — override default redirect-to-dashboard on connect
  function renderNav(opts = {}) {
    const el = document.getElementById('mw-nav');
    if (!el) return;
    injectNavStyles();

    const wallet   = getWallet();
    const active   = opts.active || '';
    const short    = wallet ? wallet.slice(0, 6) + '…' + wallet.slice(-4) : '';

    if (wallet) {
      el.innerHTML = `
        <a class="mw-logo" href="/">Mint<em>ware</em></a>
        <div class="mw-nav-right">
          <a class="mw-nav-link${active === 'dashboard'   ? ' active' : ''}" href="/dashboard">Earn</a>
          <a class="mw-nav-link${active === 'leaderboard' ? ' active' : ''}" href="/leaderboard">Leaderboard</a>
          <div class="mw-wallet-pill" onclick="window.__mwDisconnect()" title="Disconnect wallet">
            <span class="mw-wallet-dot"></span>
            ${short}
            <span class="mw-wallet-x">×</span>
          </div>
        </div>`;
    } else {
      el.innerHTML = `
        <a class="mw-logo" href="/">Mint<em>ware</em></a>
        <div class="mw-nav-right">
          <a class="mw-nav-link mw-always-show${active === 'explorer' ? ' active' : ''}" href="/explorer">Explore</a>
          <button class="mw-connect-btn" onclick="window.__mwConnectNav()">Connect Wallet</button>
        </div>`;
    }
  }

  // ── Global event handlers (called from injected HTML) ─────────────────────────
  window.__mwConnectNav = async function () {
    const addr = await connectWallet();
    if (addr) window.location.href = '/dashboard';
  };
  window.__mwDisconnect = disconnectWallet;

  // ── Account change listener ───────────────────────────────────────────────────
  var _provider = getProvider();
  if (_provider) {
    try {
      _provider.on('accountsChanged', function (accounts) {
        if (accounts.length === 0) {
          disconnectWallet();
        } else {
          setWallet(accounts[0]);
          window.location.reload();
        }
      });
    } catch (e) {}

    // Auto-sync: if provider has a different account than stored, update
    try {
      _provider.request({ method: 'eth_accounts' }).then(function (accounts) {
        const stored = getWallet();
        if (accounts.length > 0 && stored && accounts[0].toLowerCase() !== stored) {
          setWallet(accounts[0]);
          window.location.reload();
        }
      }).catch(function () {});
    } catch (e) {}
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  window.MW = {
    API,
    getWallet,
    connectWallet,
    disconnectWallet,
    requireWallet,
    renderNav,
  };

})();
