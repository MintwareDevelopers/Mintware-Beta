export function generateRefCode(address: string): string {
  return 'mw_' + address.slice(2, 8).toLowerCase()
}

export function truncateAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}
