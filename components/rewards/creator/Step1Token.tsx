'use client'

// =============================================================================
// Step1Token.tsx — Paste ERC-20 address or pick common token
//
// Validation: reads name/symbol/decimals via wagmi useReadContracts
// Shows: token name, symbol, decimals. Errors for invalid/unverified.
// Chain selector: Base (default), Ethereum, Arbitrum.
// =============================================================================

import { useState, useEffect } from 'react'
import { useReadContracts } from 'wagmi'
import { isAddress } from 'viem'
import type { CreatorFormState, TokenInfo } from '@/lib/rewards/creator'
import { CHAIN_OPTIONS, ERC20_READ_ABI } from '@/lib/rewards/creator'

interface Step1TokenProps {
  form:     CreatorFormState
  onChange: (partial: Partial<CreatorFormState>) => void
}

const COMMON_TOKENS: Record<number, { address: `0x${string}`; symbol: string; name: string; decimals: number }[]> = {
  8453: [
    { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH',  name: 'Wrapped Ether',   decimals: 18 },
    { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC',  name: 'USD Coin',        decimals: 6  },
    { address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', symbol: 'USDbC', name: 'USD Base Coin',   decimals: 6  },
  ],
  1: [
    { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', name: 'USD Coin',       decimals: 6  },
    { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI',  name: 'Dai Stablecoin', decimals: 18 },
  ],
  42161: [
    { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    { address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', symbol: 'USDC', name: 'USD Coin',       decimals: 6  },
  ],
}

function fieldStyle(focused: boolean, error: boolean): React.CSSProperties {
  return {
    width:        '100%',
    boxSizing:    'border-box',
    fontFamily:   'DM Mono, monospace',
    fontSize:     13,
    padding:      '11px 14px',
    borderRadius: 10,
    border:       `1.5px solid ${error ? '#C2537A' : focused ? '#3A5CE8' : '#E0DFFF'}`,
    background:   '#fff',
    color:        '#1A1A2E',
    outline:      'none',
    transition:   'border-color 150ms',
  }
}

export function Step1Token({ form, onChange }: Step1TokenProps) {
  const [rawInput, setRawInput]   = useState(form.token?.address ?? '')
  const [focused, setFocused]     = useState(false)
  const [touched, setTouched]     = useState(false)

  const validAddress = isAddress(rawInput) ? rawInput as `0x${string}` : undefined

  // Read ERC-20 metadata when we have a valid address
  const { data: contractReads, isLoading: reading, isError: readError } = useReadContracts({
    contracts: validAddress
      ? ([
          { address: validAddress, abi: ERC20_READ_ABI, functionName: 'name',     chainId: form.chainId },
          { address: validAddress, abi: ERC20_READ_ABI, functionName: 'symbol',   chainId: form.chainId },
          { address: validAddress, abi: ERC20_READ_ABI, functionName: 'decimals', chainId: form.chainId },
        ] as const)
      : [],
    query: { enabled: !!validAddress },
  })

  // Commit token to form when reads succeed
  useEffect(() => {
    if (!validAddress || !contractReads) return
    const [nameRes, symbolRes, decimalsRes] = contractReads
    if (
      nameRes?.status    === 'success' &&
      symbolRes?.status  === 'success' &&
      decimalsRes?.status === 'success'
    ) {
      const token: TokenInfo = {
        address:  validAddress,
        name:     nameRes.result as string,
        symbol:   symbolRes.result as string,
        decimals: decimalsRes.result as number,
        chainId:  form.chainId,
      }
      onChange({ token })
    } else if (nameRes?.status === 'failure') {
      onChange({ token: null })
    }
  }, [contractReads, validAddress, form.chainId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clear token when address/chain changes
  useEffect(() => {
    onChange({ token: null })
  }, [rawInput, form.chainId]) // eslint-disable-line react-hooks/exhaustive-deps

  function selectCommon(t: typeof COMMON_TOKENS[number][number]) {
    const token: TokenInfo = { ...t, chainId: form.chainId }
    setRawInput(t.address)
    setTouched(true)
    onChange({ token })
  }

  const isInvalidAddress = touched && rawInput.length > 0 && !isAddress(rawInput)
  const isNotFound       = touched && !!validAddress && !reading && readError
  const showToken        = !!form.token

  const commonList = COMMON_TOKENS[form.chainId] ?? []

  return (
    <>
      <style>{`
        .chain-pill {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 12px; font-weight: 600;
          padding: 7px 16px; border-radius: 20px;
          cursor: pointer; border: 1.5px solid #E0DFFF;
          background: #fff; color: #8A8C9E;
          transition: all 150ms; white-space: nowrap;
        }
        .chain-pill.active {
          background: #EEF1FF; color: #3A5CE8;
          border-color: rgba(58,92,232,0.3);
        }
        .chain-pill:hover:not(.active) { background: #F7F6FF; color: #3A3C52; }
        .common-token-btn {
          font-family: 'DM Mono', monospace;
          font-size: 11px; font-weight: 700;
          padding: 6px 14px; border-radius: 8px;
          cursor: pointer; border: 1.5px solid #E0DFFF;
          background: #F7F6FF; color: #3A3C52;
          transition: all 150ms;
        }
        .common-token-btn:hover { border-color: #3A5CE8; color: #3A5CE8; background: #EEF1FF; }
        .common-token-btn.selected { background: #EEF1FF; border-color: #3A5CE8; color: #3A5CE8; }
      `}</style>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Chain selector */}
        <div>
          <label style={{
            fontFamily: 'Plus Jakarta Sans, sans-serif',
            fontSize: 12, fontWeight: 700, color: '#8A8C9E',
            letterSpacing: '0.5px', textTransform: 'uppercase',
            display: 'block', marginBottom: 10,
          }}>
            Chain
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {CHAIN_OPTIONS.map(c => (
              <button
                key={c.id}
                className={`chain-pill${form.chainId === c.id ? ' active' : ''}`}
                onClick={() => { onChange({ chainId: c.id, token: null }); setRawInput('') }}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Token address */}
        <div>
          <label style={{
            fontFamily: 'Plus Jakarta Sans, sans-serif',
            fontSize: 12, fontWeight: 700, color: '#8A8C9E',
            letterSpacing: '0.5px', textTransform: 'uppercase',
            display: 'block', marginBottom: 10,
          }}>
            Token contract address
          </label>
          <input
            type="text"
            placeholder="0x..."
            value={rawInput}
            style={fieldStyle(focused, isInvalidAddress || isNotFound)}
            onFocus={() => setFocused(true)}
            onBlur={() => { setFocused(false); setTouched(true) }}
            onChange={(e) => setRawInput(e.target.value.trim())}
          />

          {/* Validation states */}
          {isInvalidAddress && (
            <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 12, color: '#C2537A', marginTop: 6 }}>
              Not a valid ERC-20 address
            </div>
          )}
          {isNotFound && (
            <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 12, color: '#C2537A', marginTop: 6 }}>
              Contract not found or unverified on this chain
            </div>
          )}
          {reading && validAddress && (
            <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 12, color: '#8A8C9E', marginTop: 6 }}>
              Validating contract…
            </div>
          )}

          {/* Token confirmed */}
          {showToken && form.token && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12,
              marginTop: 12,
              background: 'rgba(42,158,138,0.06)',
              border: '1px solid rgba(42,158,138,0.2)',
              borderRadius: 10, padding: '10px 14px',
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: 'rgba(42,158,138,0.12)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: 700, color: '#2A9E8A',
                flexShrink: 0,
              }}>
                {form.token.symbol.charAt(0)}
              </div>
              <div>
                <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 14, fontWeight: 700, color: '#1A1A2E' }}>
                  {form.token.name}
                </div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: '#8A8C9E', marginTop: 1 }}>
                  {form.token.symbol} · {form.token.decimals} decimals
                </div>
              </div>
              <span style={{
                marginLeft: 'auto',
                fontFamily: 'Plus Jakarta Sans, sans-serif',
                fontSize: 10, fontWeight: 700,
                background: 'rgba(42,158,138,0.1)', color: '#2A9E8A',
                border: '1px solid rgba(42,158,138,0.2)',
                borderRadius: 20, padding: '3px 8px',
              }}>
                ✓ Verified
              </span>
            </div>
          )}
        </div>

        {/* Common tokens */}
        {commonList.length > 0 && (
          <div>
            <div style={{
              fontFamily: 'Plus Jakarta Sans, sans-serif',
              fontSize: 12, fontWeight: 700, color: '#8A8C9E',
              letterSpacing: '0.5px', textTransform: 'uppercase',
              marginBottom: 10,
            }}>
              Common tokens
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {commonList.map(t => (
                <button
                  key={t.address}
                  className={`common-token-btn${form.token?.address === t.address ? ' selected' : ''}`}
                  onClick={() => selectCommon(t)}
                >
                  {t.symbol}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
