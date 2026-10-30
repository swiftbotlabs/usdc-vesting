import { arcTestnet } from 'viem/chains'
import { defineChain } from 'viem'

export const arcMainnet = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.arc.io'] } },
  blockExplorers: {
    default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' },
  },
})

export type NetworkKey = 'mainnet' | 'testnet'

export interface NetworkConfig {
  chain: typeof arcMainnet
  address: `0x${string}`
  deploymentBlock: bigint
  /** Head block up to which scheduleWindows are verified complete; null = no snapshot (full scan). */
  historySnapshotBlock: bigint | null
  /** Inclusive block range holding every event of a schedule id, up to historySnapshotBlock. */
  scheduleWindows: Record<number, [bigint, bigint]>
  label: string
  explorerBase: string
}

export const NETWORKS: Record<NetworkKey, NetworkConfig> = {
  mainnet: {
    chain: arcMainnet,
    address: '0x89137144644a6538948484d23de7ed313c8f2717',
    deploymentBlock: 26872860n,
    historySnapshotBlock: 28663171n,
    scheduleWindows: {
      1: [26872928n, 26873286n],
      2: [26873296n, 26877877n],
      3: [26873368n, 26873459n],
      4: [26877939n, 26878313n],
    },
    label: 'Arc Mainnet',
    explorerBase: 'https://explorer.arc.io',
  },
  testnet: {
    chain: arcTestnet as unknown as typeof arcMainnet,
    address: '0xa674e1230ec87ea9b92c52fb734ab216b1fb4f32',
    deploymentBlock: 68110012n,
    historySnapshotBlock: null,
    scheduleWindows: {},
    label: 'Arc Testnet',
    explorerBase: 'https://explorer.testnet.arc.io',
  },
}

export const DEFAULT_NETWORK: NetworkKey = 'mainnet'

export function getNetworkFromStorage(): NetworkKey {
  try {
    const v = localStorage.getItem('usdcvesting_network')
    if (v === 'testnet' || v === 'mainnet') return v
  } catch {
    // ignore
  }
  return DEFAULT_NETWORK
}

export function setNetworkInStorage(n: NetworkKey): void {
  try {
    localStorage.setItem('usdcvesting_network', n)
  } catch {
    // ignore
  }
}

export function explorerAddress(explorerBase: string, address: string): string {
  return `${explorerBase}/address/${address}`
}

export function explorerTx(explorerBase: string, hash: string): string {
  return `${explorerBase}/tx/${hash}`
}
