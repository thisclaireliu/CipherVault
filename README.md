# CipherVault

CipherVault is a time-locked ETH staking vault that keeps each staker's amount encrypted on-chain using Zama FHEVM. Users can deposit ETH, set (or extend) a lock period, privately decrypt their own stake, and withdraw after unlock via a public decryption proof.

## Project Overview

CipherVault focuses on one core goal: preserve stake privacy without sacrificing on-chain enforceability. The contract stores stake amounts as encrypted euint64 values, only making them publicly decryptable when a withdrawal is requested. This allows public verification of the withdrawal amount while keeping positions opaque during the lock period.

## Problem It Solves

- Public staking contracts expose amounts on-chain, enabling tracking and profiling.
- Time-locked staking often requires transparent balances for withdrawals, leaking user information.
- Users need a path to prove their withdrawal amount without revealing it early.

CipherVault solves this by combining encrypted balances with a two-step withdrawal process that reveals the amount only when the user chooses to withdraw.

## Key Advantages

- Private stake amounts: encrypted on-chain via Zama FHEVM.
- Transparent withdrawals: amount is publicly decryptable only after request.
- Simple staking UX: deposit + lock time, with lock extension on additional deposits.
- Clear security boundaries: no hidden off-chain accounting, all withdrawals are proven on-chain.
- Frontend and tasks support: end-to-end flow from staking to decryption proof.

## Technology Stack

- Smart contracts: Solidity 0.8.27, Hardhat, hardhat-deploy
- FHE layer: Zama FHEVM (@fhevm/solidity, @fhevm/hardhat-plugin)
- Frontend: React + Vite, RainbowKit + wagmi, viem for reads, ethers v6 for writes
- Relayer/decryption: @zama-fhe/relayer-sdk (Sepolia config)
- Tooling: TypeScript, TypeChain

## How It Works

1. Stake
   - User sends ETH and a lock duration.
   - Amount is encrypted as euint64 and stored on-chain.
   - Unlock time is updated to the latest of existing and proposed unlock times.

2. Private Decrypt (optional)
   - User can decrypt their own stake amount off-chain using the Zama relayer SDK.
   - This does not make the amount publicly visible.

3. Request Withdrawal
   - After unlock, user requests withdrawal.
   - Contract marks the ciphertext as publicly decryptable and emits a handle.

4. Finalize Withdrawal
   - Anyone can publicly decrypt the handle, but only the original user can finalize.
   - User submits the clear amount and proof; contract verifies and transfers ETH.

## Smart Contract Details

- Contract: `CipherVault` in `contracts/CipherVault.sol`
- Max lock duration: 365 days
- Max stake per user (encrypted amount): uint64 max in wei
- Reentrancy guard built-in
- Single position per user, with optional additional deposits
- Events: `Staked`, `WithdrawRequested`, `WithdrawFinalized`

## Frontend Details

- Lives in `ui/` and targets Sepolia only
- Reads via viem/wagmi, writes via ethers v6
- In-memory storage for wallet state (no localStorage)
- Contract address can be entered manually or generated via `vault:sync-ui`

## Repository Structure

- `contracts/` Solidity contracts
- `deploy/` Hardhat deploy scripts
- `tasks/` Hardhat tasks for staking and decryption flows
- `test/` Hardhat tests
- `ui/` React frontend
- `docs/` Zama references

## Getting Started

### Prerequisites

- Node.js 20+
- npm
- A Sepolia-funded wallet for deployment/testing

### Install Dependencies

```bash
npm install
```

### Environment Configuration

Create `.env` in the repo root:

```bash
PRIVATE_KEY=0xYOUR_PRIVATE_KEY
INFURA_API_KEY=YOUR_INFURA_KEY
ETHERSCAN_API_KEY=YOUR_ETHERSCAN_KEY
```

Notes:
- `PRIVATE_KEY` must be a raw hex private key. Do not use a mnemonic.
- `INFURA_API_KEY` is optional; a public Sepolia RPC fallback is used if omitted.

### Compile and Test

```bash
npm run compile
npm run test
```

### Local Node (FHEVM-ready)

```bash
npx hardhat node
npx hardhat deploy --network localhost
```

### Deploy to Sepolia

```bash
npx hardhat deploy --network sepolia
npx hardhat verify --network sepolia <CONTRACT_ADDRESS>
```

## CLI Tasks

Examples (all use the configured network):

```bash
npx hardhat --network sepolia vault:address
npx hardhat --network sepolia vault:stake --amount 0.01 --duration 3600
npx hardhat --network sepolia vault:status
npx hardhat --network sepolia vault:decrypt-stake
npx hardhat --network sepolia vault:request-withdraw
npx hardhat --network sepolia vault:finalize-withdraw
```

## Sync ABI + Address to the UI

The frontend must use the deployed ABI from `deployments/sepolia`. Generate the UI config after deployment:

```bash
npx hardhat --network sepolia vault:sync-ui
```

This writes `ui/src/config/cipherVault.ts` with the address and ABI.

## Run the Frontend

```bash
cd ui
npm install
npm run dev
```

Open the app, connect a wallet on Sepolia, and paste or generate the CipherVault address.

## Security and Privacy Considerations

- Ciphertexts are opaque on-chain until a withdrawal request is made.
- Only the requester can finalize the withdrawal, even after public decryption.
- The contract enforces unlock timestamps and rejects early withdrawals.
- ETH is held by the contract; encrypted values represent the claimable amount.

## Limitations

- Single position per address (deposits accumulate and extend unlock time).
- Amounts are limited to uint64 max in wei.
- No partial withdrawals (withdraw is all-at-once per position).
- The withdrawal flow requires a public decryption proof.

## Future Plans

- Partial withdrawals and multiple concurrent positions
- ERC20 support with encrypted balances
- Advanced lock strategies (cliffs, linear vesting)
- Extended UI analytics for lock schedules
- Additional networks beyond Sepolia

## License

BSD-3-Clause-Clear. See `LICENSE`.
