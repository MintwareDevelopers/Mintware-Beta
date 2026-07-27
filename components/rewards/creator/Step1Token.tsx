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
    <div className="flex flex-col gap-6">

      {/* Chain selector */}
      <div>
        <label className="font-atx-mono text-[10px] font-semibold tracking-[0.08em] uppercase text-atx-ink/55 block mb-[10px]">
          Chain
        </label>
        <div className="flex gap-2 flex-wrap">
          {CHAIN_OPTIONS.map(c => (
            <button
              key={c.id}
              className={`font-atx-mono text-[12px] font-semibold uppercase tracking-[0.06em] py-[7px] px-4 cursor-pointer border whitespace-nowrap transition-colors duration-150${form.chainId === c.id ? ' bg-atx-blue text-white border-atx-ink' : ' bg-atx-panel text-atx-ink/60 border-atx-ink/30 hover:border-atx-ink hover:text-atx-ink'}`}
              onClick={() => { onChange({ chainId: c.id, token: null }); setRawInput('') }}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Token address */}
      <div>
        <label className="font-atx-mono text-[10px] font-semibold tracking-[0.08em] uppercase text-atx-ink/55 block mb-[10px]">
          Token contract address
        </label>
        <input
          type="text"
          placeholder="0x..."
          value={rawInput}
          className={`w-full box-border font-atx-mono text-[13px] px-[14px] py-[11px] bg-atx-panel text-atx-ink outline-none transition-[border-color] duration-150 border${isInvalidAddress || isNotFound ? ' border-atx-clay' : focused ? ' border-atx-blue' : ' border-atx-ink/30'}`}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); setTouched(true) }}
          onChange={(e) => setRawInput(e.target.value.trim())}
        />

        {/* Validation states */}
        {isInvalidAddress && (
          <div className="font-atx-mono text-[12px] text-atx-clay mt-[6px]">
            Not a valid ERC-20 address
          </div>
        )}
        {isNotFound && (
          <div className="font-atx-mono text-[12px] text-atx-clay mt-[6px]">
            Contract not found or unverified on this chain
          </div>
        )}
        {reading && validAddress && (
          <div className="font-atx-mono text-[12px] text-atx-ink/60 mt-[6px]">
            Validating contract…
          </div>
        )}

        {/* Token confirmed */}
        {showToken && form.token && (
          <div className="flex items-center gap-3 mt-3 bg-atx-panel border border-atx-ink border-l-[3px] border-l-atx-mesquite px-[14px] py-[10px]">
            <div className="w-9 h-9 border border-atx-ink bg-atx-panel flex items-center justify-center font-atx-mono text-[13px] font-bold text-atx-mesquite shrink-0">
              {form.token.symbol.charAt(0)}
            </div>
            <div>
              <div className="font-atx-display text-[14px] font-bold text-atx-ink">
                {form.token.name}
              </div>
              <div className="font-atx-mono text-[11px] text-atx-ink/60 mt-[1px]">
                {form.token.symbol} · {form.token.decimals} decimals
              </div>
            </div>
            <span className="ml-auto inline-flex items-center gap-1.5 font-atx-mono text-[10px] font-bold uppercase tracking-[0.08em] bg-atx-bone text-atx-mesquite border border-atx-ink/25 px-2 py-[3px]">
              <span className="w-[8px] h-[8px] bg-atx-acid border border-atx-ink inline-block" />
              Verified
            </span>
          </div>
        )}
      </div>

      {/* Common tokens */}
      {commonList.length > 0 && (
        <div>
          <div className="font-atx-mono text-[10px] font-semibold tracking-[0.1em] uppercase text-atx-ink/55 mb-[10px]">
            Common tokens
          </div>
          <div className="flex gap-2 flex-wrap">
            {commonList.map(t => (
              <button
                key={t.address}
                className={`font-atx-mono text-[11px] font-bold py-[6px] px-[14px] cursor-pointer border transition-colors duration-150${form.token?.address === t.address ? ' bg-atx-blue border-atx-ink text-white' : ' bg-atx-panel border-atx-ink/30 text-atx-ink/70 hover:border-atx-ink hover:text-atx-ink'}`}
                onClick={() => selectCommon(t)}
              >
                {t.symbol}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
