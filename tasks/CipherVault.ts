import { FhevmType } from "@fhevm/hardhat-plugin";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";
import fs from "node:fs";
import path from "node:path";

/**
 * Examples:
 *   - npx hardhat --network sepolia vault:address
 *   - npx hardhat --network sepolia vault:stake --amount 0.01 --duration 3600
 *   - npx hardhat --network sepolia vault:status
 *   - npx hardhat --network sepolia vault:decrypt-stake
 *   - npx hardhat --network sepolia vault:request-withdraw
 *   - npx hardhat --network sepolia vault:finalize-withdraw
 */

task("vault:address", "Prints the CipherVault address").setAction(async function (_taskArguments: TaskArguments, hre) {
  const { deployments } = hre;
  const vault = await deployments.get("CipherVault");
  console.log("CipherVault address is " + vault.address);
});

task("vault:stake", "Stake ETH into CipherVault")
  .addParam("amount", "Amount in ETH, e.g. 0.01")
  .addParam("duration", "Lock duration in seconds")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;

    const vaultDeployment = await deployments.get("CipherVault");
    const signer = (await ethers.getSigners())[0];
    const vault = await ethers.getContractAt("CipherVault", vaultDeployment.address, signer);

    const amountWei = ethers.parseEther(taskArguments.amount);
    const durationSeconds = BigInt(taskArguments.duration);

    const tx = await vault.stake(durationSeconds, { value: amountWei });
    console.log(`Wait for tx:${tx.hash}...`);
    const receipt = await tx.wait();
    console.log(`tx:${tx.hash} status=${receipt?.status}`);
  });

task("vault:status", "Prints the caller's stake status").setAction(async function (_taskArguments: TaskArguments, hre) {
  const { ethers, deployments } = hre;
  const vaultDeployment = await deployments.get("CipherVault");
  const signer = (await ethers.getSigners())[0];
  const user = signer.address;

  const vault = await ethers.getContractAt("CipherVault", vaultDeployment.address, signer);
  const encryptedStake = await vault.getStakeEncrypted(user);
  const unlock = await vault.getUnlockTimestamp(user);
  const pendingHandle = await vault.getPendingWithdrawHandle(user);

  console.log(`User: ${user}`);
  console.log(`Encrypted stake handle: ${encryptedStake}`);
  console.log(`Unlock timestamp: ${unlock} (${new Date(Number(unlock) * 1000).toISOString()})`);
  console.log(`Pending withdraw handle: ${pendingHandle}`);
});

task("vault:decrypt-stake", "Decrypt the caller's encrypted stake amount (user decryption)")
  .setAction(async function (_taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;

    await fhevm.initializeCLIApi();

    const vaultDeployment = await deployments.get("CipherVault");
    const signer = (await ethers.getSigners())[0];
    const user = signer.address;

    const vault = await ethers.getContractAt("CipherVault", vaultDeployment.address, signer);
    const encryptedStake = await vault.getStakeEncrypted(user);
    if (encryptedStake === ethers.ZeroHash) {
      console.log("Encrypted stake: 0x0");
      console.log("Clear stake    : 0");
      return;
    }

    const clearStake = await fhevm.userDecryptEuint(FhevmType.euint64, encryptedStake, vaultDeployment.address, signer);
    console.log(`Encrypted stake: ${encryptedStake}`);
    console.log(`Clear stake    : ${clearStake} wei`);
  });

task("vault:request-withdraw", "Request withdrawal (marks stake publicly decryptable)")
  .setAction(async function (_taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;
    const vaultDeployment = await deployments.get("CipherVault");
    const signer = (await ethers.getSigners())[0];
    const vault = await ethers.getContractAt("CipherVault", vaultDeployment.address, signer);

    const tx = await vault.requestWithdraw();
    console.log(`Wait for tx:${tx.hash}...`);
    const receipt = await tx.wait();
    console.log(`tx:${tx.hash} status=${receipt?.status}`);

    const pendingHandle = await vault.getPendingWithdrawHandle(signer.address);
    console.log(`Pending withdraw handle: ${pendingHandle}`);
  });

task("vault:finalize-withdraw", "Public decrypt + finalize withdrawal")
  .setAction(async function (_taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;

    await fhevm.initializeCLIApi();

    const vaultDeployment = await deployments.get("CipherVault");
    const signer = (await ethers.getSigners())[0];
    const user = signer.address;
    const vault = await ethers.getContractAt("CipherVault", vaultDeployment.address, signer);

    const handle: string = await vault.getPendingWithdrawHandle(user);
    if (handle === ethers.ZeroHash) {
      throw new Error("No pending withdraw handle. Call vault:request-withdraw first.");
    }

    const decrypted = await fhevm.publicDecrypt([handle]);
    const clear = decrypted.clearValues[handle] as bigint;
    const proof = decrypted.decryptionProof;

    console.log(`Public decrypted amount: ${clear} wei`);
    const tx = await vault.finalizeWithdraw(handle, clear, proof);
    console.log(`Wait for tx:${tx.hash}...`);
    const receipt = await tx.wait();
    console.log(`tx:${tx.hash} status=${receipt?.status}`);
  });

task("vault:sync-ui", "Generate ui/src/config/cipherVault.ts from hardhat-deploy deployments")
  .addOptionalParam("out", "Output filepath", "ui/src/config/cipherVault.ts")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { deployments } = hre;
    const outPath = String(taskArguments.out);

    const deployment = await deployments.get("CipherVault");
    const abi = deployment.abi ?? [];

    const contents = `/* Auto-generated by: npx hardhat vault:sync-ui --network ${hre.network.name} */\n` +
      `export const CIPHERVAULT_ADDRESS = ${JSON.stringify(deployment.address)} as const;\n\n` +
      `export const CIPHERVAULT_ABI = ${JSON.stringify(abi, null, 2)} as const;\n`;

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, contents, { encoding: "utf8" });

    console.log(`Wrote ${outPath}`);
  });
