import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { CipherVault, CipherVault__factory } from "../types";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
};

async function deployFixture() {
  const factory = (await ethers.getContractFactory("CipherVault")) as CipherVault__factory;
  const vault = (await factory.deploy()) as CipherVault;
  const vaultAddress = await vault.getAddress();
  return { vault, vaultAddress };
}

describe("CipherVault", function () {
  let signers: Signers;
  let vault: CipherVault;
  let vaultAddress: string;

  before(async function () {
    const ethSigners = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn(`This hardhat test suite cannot run on Sepolia Testnet`);
      this.skip();
    }
    ({ vault, vaultAddress } = await deployFixture());
  });

  it("stakes and decrypts the encrypted amount", async function () {
    const stakeAmount = ethers.parseEther("1.0");
    const duration = 3600n;

    await (await vault.connect(signers.alice).stake(duration, { value: stakeAmount })).wait();

    const encrypted = await vault.getStakeEncrypted(signers.alice.address);
    expect(encrypted).to.not.eq(ethers.ZeroHash);

    const clear = await fhevm.userDecryptEuint(FhevmType.euint64, encrypted, vaultAddress, signers.alice);
    expect(clear).to.eq(stakeAmount);
  });

  it("prevents withdrawal before unlock", async function () {
    const stakeAmount = ethers.parseEther("0.5");
    const duration = 3600n;

    await (await vault.connect(signers.alice).stake(duration, { value: stakeAmount })).wait();

    await expect(vault.connect(signers.alice).requestWithdraw()).to.be.revertedWithCustomError(vault, "StakeLocked");
  });

  it("requests withdrawal, public decrypts, and finalizes withdrawal", async function () {
    const stakeAmount = ethers.parseEther("0.25");
    const duration = 1n;

    await (await vault.connect(signers.alice).stake(duration, { value: stakeAmount })).wait();

    await ethers.provider.send("evm_increaseTime", [Number(duration) + 1]);
    await ethers.provider.send("evm_mine", []);

    await (await vault.connect(signers.alice).requestWithdraw()).wait();
    const handle = await vault.getPendingWithdrawHandle(signers.alice.address);
    expect(handle).to.not.eq(ethers.ZeroHash);

    const decrypted = await fhevm.publicDecrypt([handle]);
    const clear = decrypted.clearValues[handle] as bigint;
    const proof = decrypted.decryptionProof;
    expect(clear).to.eq(stakeAmount);

    const contractBalanceBefore = await ethers.provider.getBalance(vaultAddress);
    expect(contractBalanceBefore).to.eq(stakeAmount);

    await (await vault.connect(signers.alice).finalizeWithdraw(handle, clear, proof)).wait();

    const contractBalanceAfter = await ethers.provider.getBalance(vaultAddress);
    expect(contractBalanceAfter).to.eq(0);

    const pendingAfter = await vault.getPendingWithdrawHandle(signers.alice.address);
    expect(pendingAfter).to.eq(ethers.ZeroHash);

    const encryptedAfter = await vault.getStakeEncrypted(signers.alice.address);
    const clearAfter = await fhevm.userDecryptEuint(FhevmType.euint64, encryptedAfter, vaultAddress, signers.alice);
    expect(clearAfter).to.eq(0);
  });
});

