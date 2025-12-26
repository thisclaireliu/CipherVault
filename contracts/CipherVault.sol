// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title CipherVault
/// @notice Stake ETH with an encrypted on-chain record of the staked amount.
/// @dev The staked amount is made publicly decryptable only when a withdrawal is requested.
contract CipherVault is ZamaEthereumConfig {
    struct Position {
        euint64 encryptedAmountWei;
        uint64 unlockTimestamp;
        bytes32 pendingWithdrawHandle;
    }

    uint64 public constant MAX_STAKE_DURATION = 365 days;

    mapping(address user => Position) private _positions;
    mapping(bytes32 amountHandle => address user) private _withdrawRequests;

    bool private _locked;

    event Staked(address indexed user, uint256 amountWei, uint64 unlockTimestamp);
    event WithdrawRequested(address indexed user, bytes32 indexed amountHandle);
    event WithdrawFinalized(address indexed user, uint64 amountWei);

    error DurationOutOfBounds(uint64 durationSeconds);
    error AmountTooLarge(uint256 amountWei);
    error ZeroStakeAmount();
    error NoActiveStake(address user);
    error StakeLocked(address user, uint64 unlockTimestamp);
    error WithdrawAlreadyPending(address user);
    error WithdrawRequestAlreadyExists(bytes32 amountHandle);
    error UnknownWithdrawRequest(bytes32 amountHandle);
    error UnauthorizedFinalizer(address caller, address expected);
    error TransferFailed();

    modifier nonReentrant() {
        require(!_locked, "REENTRANCY");
        _locked = true;
        _;
        _locked = false;
    }

    function stake(uint64 durationSeconds) external payable nonReentrant {
        if (durationSeconds == 0 || durationSeconds > MAX_STAKE_DURATION) {
            revert DurationOutOfBounds(durationSeconds);
        }
        if (msg.value == 0) {
            revert ZeroStakeAmount();
        }
        if (msg.value > type(uint64).max) {
            revert AmountTooLarge(msg.value);
        }

        Position storage position = _positions[msg.sender];
        if (position.pendingWithdrawHandle != bytes32(0)) {
            revert WithdrawAlreadyPending(msg.sender);
        }

        euint64 previous = position.encryptedAmountWei;
        euint64 deposited = FHE.asEuint64(uint64(msg.value));

        euint64 updated;
        if (euint64.unwrap(previous) == bytes32(0)) {
            updated = deposited;
        } else {
            updated = FHE.add(previous, deposited);
        }

        position.encryptedAmountWei = updated;
        uint64 proposedUnlock = uint64(block.timestamp) + durationSeconds;
        if (position.unlockTimestamp < proposedUnlock) {
            position.unlockTimestamp = proposedUnlock;
        }

        FHE.allowThis(position.encryptedAmountWei);
        FHE.allow(position.encryptedAmountWei, msg.sender);

        emit Staked(msg.sender, msg.value, position.unlockTimestamp);
    }

    /// @notice Mark the caller's encrypted stake amount as publicly decryptable and emit a request event.
    function requestWithdraw() external nonReentrant {
        Position storage position = _positions[msg.sender];
        if (position.pendingWithdrawHandle != bytes32(0)) {
            revert WithdrawAlreadyPending(msg.sender);
        }

        bytes32 handle = euint64.unwrap(position.encryptedAmountWei);
        if (handle == bytes32(0)) {
            revert NoActiveStake(msg.sender);
        }
        if (block.timestamp < position.unlockTimestamp) {
            revert StakeLocked(msg.sender, position.unlockTimestamp);
        }
        if (_withdrawRequests[handle] != address(0)) {
            revert WithdrawRequestAlreadyExists(handle);
        }

        FHE.makePubliclyDecryptable(position.encryptedAmountWei);

        position.pendingWithdrawHandle = handle;
        _withdrawRequests[handle] = msg.sender;

        emit WithdrawRequested(msg.sender, handle);
    }

    /// @notice Finalize a withdrawal by providing the cleartext amount and a decryption proof for the handle.
    function finalizeWithdraw(bytes32 amountHandle, uint64 amountWei, bytes calldata decryptionProof) external nonReentrant {
        address user = _withdrawRequests[amountHandle];
        if (user == address(0)) {
            revert UnknownWithdrawRequest(amountHandle);
        }
        if (msg.sender != user) {
            revert UnauthorizedFinalizer(msg.sender, user);
        }

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = amountHandle;
        bytes memory cleartexts = abi.encode(amountWei);

        FHE.checkSignatures(handles, cleartexts, decryptionProof);

        delete _withdrawRequests[amountHandle];

        Position storage position = _positions[user];
        position.pendingWithdrawHandle = bytes32(0);
        position.unlockTimestamp = 0;
        position.encryptedAmountWei = FHE.asEuint64(0);
        FHE.allowThis(position.encryptedAmountWei);
        FHE.allow(position.encryptedAmountWei, user);

        (bool ok, ) = user.call{value: amountWei}("");
        if (!ok) {
            revert TransferFailed();
        }

        emit WithdrawFinalized(user, amountWei);
    }

    function getStakeEncrypted(address user) external view returns (euint64) {
        return _positions[user].encryptedAmountWei;
    }

    function getUnlockTimestamp(address user) external view returns (uint64) {
        return _positions[user].unlockTimestamp;
    }

    function getPendingWithdrawHandle(address user) external view returns (bytes32) {
        return _positions[user].pendingWithdrawHandle;
    }
}
