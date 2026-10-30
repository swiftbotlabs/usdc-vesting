# USDC Vesting

**by Swift Bot Labs**

> Vesting and scheduled payouts in USDC on Arc: deposit once, the clock releases it.

A non-custodial USDC vesting app built on Arc. Create linear vesting schedules (with optional cliff) or dated tranche payouts. The smart contract holds custody; anyone can trigger a payout, but funds always go to the registered beneficiary.

Live app: **https://swiftbotlab.github.io/usdc-vesting/**

---

## What it does

- **Linear vesting** — deposit USDC, set start/cliff/end, the contract releases it proportionally by the second.
- **Tranche payouts** — define up to 100 dated payouts; each becomes claimable at its timestamp.
- **Claim** — anyone can call `claim(id)`; funds always go to the beneficiary.
- **Cancel** — revocable schedules only: funder cancels and receives back only the unvested portion; the vested portion stays claimable by the beneficiary.
- **Timeline** — `ScheduleCreated`, `TrancheAdded`, `Claimed`, `Cancelled` events fetched on-demand in 9,000-block chunks from the deployment block.

## Rules

- All amounts are 18-decimal native USDC (Arc's `msg.value`). The 6-decimal ERC-20 at `0x3600...` is not used.
- `maxFeePerGas` is set to at least 20 gwei (Arc mempool floor).
- No external oracles, no admins, no upgrade proxies.
- Non-revocable schedules cannot be cancelled under any circumstances.
- A beneficiary that cannot receive native USDC (e.g. a contract that rejects plain transfers) will see `TransferFailed` on claim. The vested amount remains locked; a funder with a revocable schedule can cancel to recover the unvested part.

## Deployed contracts

| Chain | Address | Explorer |
|---|---|---|
| Arc Mainnet | `0x89137144644a6538948484d23de7ed313c8f2717` | [explorer.arc.io](https://explorer.arc.io/address/0x89137144644a6538948484d23de7ed313c8f2717) |
| Arc Testnet | `0xa674e1230ec87ea9b92c52fb734ab216b1fb4f32` | [explorer.testnet.arc.io](https://explorer.testnet.arc.io/address/0xa674e1230ec87ea9b92c52fb734ab216b1fb4f32) |

Both use identical bytecode.

## Live on Arc mainnet

Deployment: block 26872860, source verified, byte-identical to the testnet deployment.

| # | Event | Tx hash | Explorer |
|---|---|---|---|
| — | **Deploy** | `0x4cc755b8cdc41cedd700eeb69507526991a7a18b5bece37b1c85b78ad5775f15` | [view](https://explorer.arc.io/tx/0x4cc755b8cdc41cedd700eeb69507526991a7a18b5bece37b1c85b78ad5775f15) |
| 1 | Create (linear 0.06 USDC) | `0xa353a4796c9f6eee9bed9cd62f1d3aaf84b01bc79af6461e52399049d2b908d1` | [view](https://explorer.arc.io/tx/0xa353a4796c9f6eee9bed9cd62f1d3aaf84b01bc79af6461e52399049d2b908d1) |
| 1 | Claim 0.021 USDC | `0xdb949920e22b89afaf16cb351d99067b46d1468250a5c24a4ec7b5fa073af15a` | [view](https://explorer.arc.io/tx/0xdb949920e22b89afaf16cb351d99067b46d1468250a5c24a4ec7b5fa073af15a) |
| 1 | Claim 0.039 USDC | `0x25584b8c61fe24b085d663bf05b8cff9038222f849d4f99364056230107375d5` | [view](https://explorer.arc.io/tx/0x25584b8c61fe24b085d663bf05b8cff9038222f849d4f99364056230107375d5) |
| 2 | Create (tranches 3×0.02 USDC) | `0x837f6caef278fa4204a2f136b38328e1ad3e5ebb0fcf4ac7c92db6a061898155` | [view](https://explorer.arc.io/tx/0x837f6caef278fa4204a2f136b38328e1ad3e5ebb0fcf4ac7c92db6a061898155) |
| 2 | Claim tranche 1 | `0xe68d14f19af735146bd9ccf3eeb6eca5d9d5215eb8b00647f8f819c814370ae9` | [view](https://explorer.arc.io/tx/0xe68d14f19af735146bd9ccf3eeb6eca5d9d5215eb8b00647f8f819c814370ae9) |
| 3 | Create (revocable 0.10 USDC) | `0xaaca91fd9bcf32f9a9c923a67da46c55b2be90f0447ce11ab1a9ad6bf97fb5e7` | [view](https://explorer.arc.io/tx/0xaaca91fd9bcf32f9a9c923a67da46c55b2be90f0447ce11ab1a9ad6bf97fb5e7) |
| 3 | Cancel (0.064167 USDC back to funder) | `0x63f85049343b4369ea25285de4d9c93529f3a5e1ba1ac37e7cabe8dde4e72b57` | [view](https://explorer.arc.io/tx/0x63f85049343b4369ea25285de4d9c93529f3a5e1ba1ac37e7cabe8dde4e72b57) |
| 3 | Claim 0.035833 USDC (beneficiary, post-cancel) | `0xe4db89e8555b8474f61164af02f89c9bd904c4e462162aa17fb0e3c4951b8463` | [view](https://explorer.arc.io/tx/0xe4db89e8555b8474f61164af02f89c9bd904c4e462162aa17fb0e3c4951b8463) |

## Run locally

```bash
bun install
bun run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Build

```bash
bun run build
```

Output goes to `dist/`. The app is configured for sub-path serving (`base: './'`) and uses hash routing, so it works from any path (e.g. `swiftbotlab.github.io/usdc-vesting/`).

## Stack

- React 18 + Vite + TypeScript
- wagmi v2 + viem + ConnectKit (injected wallet only)
- Tailwind CSS (dark fintech, red brand accent)
- Self-hosted fonts via `@fontsource` (Space Grotesk, DM Sans, JetBrains Mono)
- No external RPC proxies — uses Arc's public RPC endpoints directly
- Production CSP via Vite `transformIndexHtml` plugin

## Limitations

- No beneficiary change after creation.
- No arbiter or dispute resolution.
- All schedule data is public on-chain.
- A contract beneficiary that cannot receive native USDC cannot be paid (see above).
- Timeline scan starts from the deployment block; very long histories may take a few seconds.

---

## Notes added by Swift Bot Labs (everything above this line was written by Arc Studio)

**Through the live app on Arc mainnet** (an injected wallet, fresh addresses of ours):

| # | What happened | USDC | Tx |
|---|---|---|---|
| 2 | Beneficiary claims tranches 2 + 3 in the app | 0.04 | [0x0b67ce1f…5e7d](https://explorer.arc.io/tx/0x0b67ce1f8dc51096e861ce8ffbada368f2ce07643f5847418a0c464c8d4b5e7d) |
| 4 | "3-minute test" linear schedule created in the app | 0.05 | [0x84eb3e47…2675](https://explorer.arc.io/tx/0x84eb3e47c46613ebf95070e47dd96f5059c84c35dc4c7e89384ebe59a9a42675) |
| 4 | Beneficiary claims the vested part | 0.018333 | [0x5b6e0206…c471](https://explorer.arc.io/tx/0x5b6e0206cc011f21f11553cbed47c146ef425082de5b9d06ffddea4d54f7c471) |
| 4 | Claims the rest after the end (completed) | 0.031667 | [0xefe30989…a5f](https://explorer.arc.io/tx/0xefe30989e1697552e6abf39ac2bd2571a809f0eec956937b00d5c47953f85a5f) |

**How it was built.** One Arc Studio project (https://studio.arc.io/app/1a3a084e-f255-4435-985a-7be76f606025), driven
through the Arc Studio CLI in 5 turns: (1) smart-contract pipeline: contract, Foundry suite, two auditors (stack-too-deep fix;
blocklisted-beneficiary limitation), cut off by the daily limit; (2) the pipeline continued: Slither, 76 tests passing (71 unit/fuzz
+ 5 invariants, 256 runs x 128,000 calls), Arc Testnet deploy, ABI; (3) the app; (4) one fix turn with 16 findings from our
end-to-end test; (5) a fix turn on Oct 30: the schedule Timeline now reads each schedule only inside its known block window
(verified with a full log scan up to block 28663171, kept in `src/config/networks.ts`) plus the newer blocks, one call at a time
with retry and a local cache, so it loads in seconds instead of scanning ~200 chunks from the deployment block (the Studio-written
notes above about scanning from the deployment block describe the earlier version). We re-ran the tests locally, deployed the
byte-identical bytecode to Arc mainnet (our deploy script refuses otherwise) and ran the demos. Contract and app code in this repo
are exactly as Studio wrote them: a hand-written Timeline patch we pushed on Oct 21 was replaced by Studio's turn 5 on Oct 30.

**Hosting.** Arc Studio does not export `dist/`, so `.github/workflows/pages.yml` (ours) installs from Studio's `bun.lock` and runs
`vite build` on this source; GitHub Pages serves the result. `package.json` has no `build` script: use `bunx vite build` locally.

**Video walkthrough:** https://github.com/swiftbotlab/usdc-vesting/releases/download/v1.0.0/usdc-vesting-arc-studio-mainnet.mp4

Hand-added files: `.github/workflows/pages.yml`, `SECURITY.md`, `LICENSE`, `logo.png`, and this section.
