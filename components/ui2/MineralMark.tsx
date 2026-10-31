// Mintware mark (Mineral): three stacked discs — liquidity, collateral and credit in one engine.
export function MineralMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <ellipse cx="16" cy="23" rx="13" ry="5" fill="#E58C66" />
      <ellipse cx="16" cy="21" rx="13" ry="5" fill="#F2CBC2" />
      <ellipse cx="16" cy="15.5" rx="10.5" ry="4.2" fill="#8E7FE0" />
      <ellipse cx="16" cy="14" rx="10.5" ry="4.2" fill="#D6CFF6" />
      <ellipse cx="16" cy="9" rx="8" ry="3.4" fill="#5B5BE6" />
      <ellipse cx="16" cy="7.6" rx="8" ry="3.4" fill="#B3B2FB" />
    </svg>
  )
}
