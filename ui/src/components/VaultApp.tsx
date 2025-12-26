import { useMemo, useState } from "react";
import { useAccount, useChainId, useReadContract } from "wagmi";
import { type Address, isAddress, formatEther } from "viem";
import { Contract, ethers } from "ethers";

import { CIPHERVAULT_ABI, CIPHERVAULT_ADDRESS } from "../config/cipherVault";
import { useEthersSigner } from "../hooks/useEthersSigner";
import { useZamaInstance } from "../hooks/useZamaInstance";
import "../styles/VaultApp.css";

const SEPOLIA_CHAIN_ID = 11155111;
const DUMMY_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

function asBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);
  throw new Error("Unsupported bigint value");
}

export function VaultApp() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();

  const { instance, isLoading: zamaLoading, error: zamaError } = useZamaInstance();
  const signerPromise = useEthersSigner({ chainId: SEPOLIA_CHAIN_ID });

  const [contractOverride, setContractOverride] = useState<string>("");
  const [stakeAmountEth, setStakeAmountEth] = useState<string>("");
  const [stakeDurationSeconds, setStakeDurationSeconds] = useState<string>("3600");

  const [txStatus, setTxStatus] = useState<string>("");
  const [error, setError] = useState<string>("");

  const [decryptedStakeWei, setDecryptedStakeWei] = useState<bigint | null>(null);
  const [isDecryptingStake, setIsDecryptingStake] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);
  const [isStaking, setIsStaking] = useState(false);

  const vaultAddressString = contractOverride.trim() || CIPHERVAULT_ADDRESS;
  const vaultAddress: Address | undefined = useMemo(() => {
    if (!vaultAddressString) return undefined;
    if (!isAddress(vaultAddressString)) return undefined;
    if (vaultAddressString.toLowerCase() === "0x0000000000000000000000000000000000000000") return undefined;
    return vaultAddressString as Address;
  }, [vaultAddressString]);

  const readsEnabled = Boolean(isConnected && address && vaultAddress);

  const { data: encryptedStake } = useReadContract({
    address: (vaultAddress ?? DUMMY_ADDRESS) as Address,
    abi: CIPHERVAULT_ABI,
    functionName: "getStakeEncrypted",
    args: address ? [address] : undefined,
    query: { enabled: readsEnabled },
  });

  const { data: unlockTimestamp } = useReadContract({
    address: (vaultAddress ?? DUMMY_ADDRESS) as Address,
    abi: CIPHERVAULT_ABI,
    functionName: "getUnlockTimestamp",
    args: address ? [address] : undefined,
    query: { enabled: readsEnabled },
  });

  const { data: pendingWithdrawHandle } = useReadContract({
    address: (vaultAddress ?? DUMMY_ADDRESS) as Address,
    abi: CIPHERVAULT_ABI,
    functionName: "getPendingWithdrawHandle",
    args: address ? [address] : undefined,
    query: { enabled: readsEnabled },
  });

  const nowSeconds = Math.floor(Date.now() / 1000);
  const unlockSeconds = unlockTimestamp ? Number(unlockTimestamp) : 0;
  const isUnlocked = unlockSeconds > 0 && nowSeconds >= unlockSeconds;
  const hasPendingWithdraw = Boolean(pendingWithdrawHandle && pendingWithdrawHandle !== ethers.ZeroHash);

  const needsSepolia = isConnected && chainId !== SEPOLIA_CHAIN_ID;

  const clearMessages = () => {
    setError("");
    setTxStatus("");
  };

  const getWriteContract = async () => {
    if (!vaultAddress) throw new Error("Set a valid CipherVault address first.");
    if (!signerPromise) throw new Error("Connect a wallet first.");
    const signer = await signerPromise;
    if (!signer) throw new Error("Signer unavailable.");
    return new Contract(vaultAddress, CIPHERVAULT_ABI, signer);
  };

  const onStake = async () => {
    clearMessages();
    setDecryptedStakeWei(null);
    if (needsSepolia) {
      setError("Please switch your wallet to Sepolia.");
      return;
    }
    if (!stakeAmountEth) {
      setError("Enter an ETH amount.");
      return;
    }
    if (!stakeDurationSeconds) {
      setError("Enter a duration in seconds.");
      return;
    }

    let valueWei: bigint;
    let duration: bigint;
    try {
      valueWei = ethers.parseEther(stakeAmountEth);
      duration = BigInt(stakeDurationSeconds);
    } catch {
      setError("Invalid amount or duration.");
      return;
    }

    try {
      setIsStaking(true);
      const vault = await getWriteContract();
      setTxStatus("Confirm the stake transaction in your wallet...");
      const tx = await vault.stake(duration, { value: valueWei });
      setTxStatus(`Staking... tx=${tx.hash}`);
      await tx.wait();
      setTxStatus("Stake confirmed.");
      setStakeAmountEth("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to stake.");
    } finally {
      setIsStaking(false);
    }
  };

  const onDecryptStake = async () => {
    clearMessages();
    setDecryptedStakeWei(null);
    if (!instance || zamaLoading) {
      setError("Encryption service is still initializing.");
      return;
    }
    if (zamaError) {
      setError(zamaError);
      return;
    }
    if (!vaultAddress) {
      setError("Set a valid CipherVault address first.");
      return;
    }
    if (!address) {
      setError("Connect a wallet first.");
      return;
    }
    if (!encryptedStake || encryptedStake === ethers.ZeroHash) {
      setError("No stake found.");
      return;
    }
    if (!signerPromise) {
      setError("Signer unavailable.");
      return;
    }

    setIsDecryptingStake(true);
    try {
      const keypair = instance.generateKeypair();
      const handleContractPairs = [{ handle: encryptedStake, contractAddress: vaultAddress }];

      const startTimestamp = Math.floor(Date.now() / 1000).toString();
      const durationDays = "10";
      const contractAddresses = [vaultAddress];

      const eip712 = instance.createEIP712(keypair.publicKey, contractAddresses, startTimestamp, durationDays);
      const signer = await signerPromise;
      if (!signer) throw new Error("Signer unavailable.");

      const signature = await signer.signTypedData(
        eip712.domain,
        { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
        eip712.message,
      );

      const result = await instance.userDecrypt(
        handleContractPairs,
        keypair.privateKey,
        keypair.publicKey,
        signature.replace("0x", ""),
        contractAddresses,
        address,
        startTimestamp,
        durationDays,
      );

      const decrypted = result[encryptedStake as string];
      const wei = asBigInt(decrypted);
      setDecryptedStakeWei(wei);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to decrypt.");
    } finally {
      setIsDecryptingStake(false);
    }
  };

  const onRequestWithdraw = async () => {
    clearMessages();
    setDecryptedStakeWei(null);
    if (needsSepolia) {
      setError("Please switch your wallet to Sepolia.");
      return;
    }
    try {
      setIsRequesting(true);
      const vault = await getWriteContract();
      setTxStatus("Confirm the withdrawal request in your wallet...");
      const tx = await vault.requestWithdraw();
      setTxStatus(`Requesting withdrawal... tx=${tx.hash}`);
      await tx.wait();
      setTxStatus("Withdrawal request confirmed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to request withdrawal.");
    } finally {
      setIsRequesting(false);
    }
  };

  const onFinalizeWithdraw = async () => {
    clearMessages();
    setDecryptedStakeWei(null);
    if (!instance || zamaLoading) {
      setError("Encryption service is still initializing.");
      return;
    }
    if (zamaError) {
      setError(zamaError);
      return;
    }
    if (needsSepolia) {
      setError("Please switch your wallet to Sepolia.");
      return;
    }
    if (!vaultAddress) {
      setError("Set a valid CipherVault address first.");
      return;
    }
    if (!pendingWithdrawHandle || pendingWithdrawHandle === ethers.ZeroHash) {
      setError("No pending withdrawal.");
      return;
    }

    setIsFinalizing(true);
    try {
      const decrypted = await instance.publicDecrypt([pendingWithdrawHandle]);
      const clearWei = asBigInt(decrypted.clearValues[pendingWithdrawHandle]);
      const proof = decrypted.decryptionProof;

      const vault = await getWriteContract();
      setTxStatus("Confirm the finalize transaction in your wallet...");
      const tx = await vault.finalizeWithdraw(pendingWithdrawHandle, clearWei, proof);
      setTxStatus(`Finalizing withdrawal... tx=${tx.hash}`);
      await tx.wait();
      setTxStatus(`Withdrawal finalized: ${formatEther(clearWei)} ETH`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to finalize withdrawal.");
    } finally {
      setIsFinalizing(false);
    }
  };

  return (
    <div className="vault-app">
      <div className="vault-grid">
        <section className="card">
          <h2 className="card-title">Contract</h2>
          <p className="card-subtitle">
            Paste your deployed Sepolia CipherVault address (or generate `ui/src/config/cipherVault.ts` via `vault:sync-ui`).
          </p>
          <label className="label">CipherVault address (Sepolia)</label>
          <input
            className="input"
            placeholder="0x..."
            value={contractOverride}
            onChange={(e) => setContractOverride(e.target.value)}
          />
          <div className="hint">
            Active: <code>{vaultAddress ?? "not set"}</code>
          </div>
        </section>

        <section className="card">
          <h2 className="card-title">Stake</h2>
          <label className="label">Amount (ETH)</label>
          <input
            className="input"
            inputMode="decimal"
            placeholder="0.01"
            value={stakeAmountEth}
            onChange={(e) => setStakeAmountEth(e.target.value)}
          />

          <label className="label">Duration (seconds)</label>
          <input
            className="input"
            inputMode="numeric"
            placeholder="3600"
            value={stakeDurationSeconds}
            onChange={(e) => setStakeDurationSeconds(e.target.value)}
          />

          <button className="button" onClick={onStake} disabled={!isConnected || !vaultAddress || isStaking}>
            {isStaking ? "Staking..." : "Stake ETH"}
          </button>
        </section>

        <section className="card">
          <h2 className="card-title">Position</h2>
          {!isConnected ? (
            <p className="muted">Connect a wallet to view your position.</p>
          ) : !vaultAddress ? (
            <p className="muted">Set a valid contract address to read data.</p>
          ) : (
            <>
              <div className="row">
                <div className="row-label">Encrypted stake handle</div>
                <code className="mono">{encryptedStake ?? "—"}</code>
              </div>
              <div className="row">
                <div className="row-label">Unlock time</div>
                <div className="row-value">
                  {unlockSeconds ? new Date(unlockSeconds * 1000).toLocaleString() : "—"}
                  {unlockSeconds ? (
                    <span className={`pill ${isUnlocked ? "pill-ok" : "pill-warn"}`}>
                      {isUnlocked ? "Unlocked" : "Locked"}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="row">
                <div className="row-label">Pending withdraw handle</div>
                <code className="mono">{pendingWithdrawHandle ?? "—"}</code>
              </div>

              <button className="button secondary" onClick={onDecryptStake} disabled={isDecryptingStake || zamaLoading}>
                {isDecryptingStake ? "Decrypting..." : "Decrypt My Stake"}
              </button>
              {decryptedStakeWei !== null ? (
                <div className="result">
                  Decrypted: <strong>{formatEther(decryptedStakeWei)} ETH</strong> (<code>{decryptedStakeWei.toString()}</code>{" "}
                  wei)
                </div>
              ) : null}
            </>
          )}
        </section>

        <section className="card">
          <h2 className="card-title">Withdraw</h2>
          <p className="card-subtitle">
            Withdrawal is a 2-step flow: request (makes ciphertext publicly decryptable), then finalize with a public decryption proof.
          </p>

          <div className="button-row">
            <button className="button secondary" onClick={onRequestWithdraw} disabled={!isConnected || !vaultAddress || isRequesting}>
              {isRequesting ? "Requesting..." : "Request Withdraw"}
            </button>
            <button
              className="button"
              onClick={onFinalizeWithdraw}
              disabled={!isConnected || !vaultAddress || !hasPendingWithdraw || isFinalizing || zamaLoading}
            >
              {isFinalizing ? "Finalizing..." : "Finalize Withdraw"}
            </button>
          </div>

          {!hasPendingWithdraw ? <div className="hint">Finalize is enabled after you request a withdrawal.</div> : null}
        </section>
      </div>

      {needsSepolia ? <div className="banner warn">Wallet is on chainId {chainId}. Switch to Sepolia (11155111).</div> : null}
      {zamaError ? <div className="banner warn">{zamaError}</div> : null}
      {error ? <div className="banner error">{error}</div> : null}
      {txStatus ? <div className="banner ok">{txStatus}</div> : null}
    </div>
  );
}
