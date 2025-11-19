pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract MoraleFHE is ZamaEthereumConfig {
    struct Feedback {
        euint32 encryptedMood;
        uint256 timestamp;
        bool isVerified;
        uint32 decryptedMood;
    }

    mapping(address => Feedback) public userFeedback;
    address[] public participants;

    event FeedbackSubmitted(address indexed user);
    event FeedbackVerified(address indexed user, uint32 mood);

    constructor() ZamaEthereumConfig() {
    }

    function submitFeedback(
        externalEuint32 encryptedMood,
        bytes calldata inputProof
    ) external {
        require(!userFeedback[msg.sender].isVerified, "Feedback already submitted");
        require(FHE.isInitialized(FHE.fromExternal(encryptedMood, inputProof)), "Invalid encrypted input");

        euint32 encrypted = FHE.fromExternal(encryptedMood, inputProof);
        FHE.allowThis(encrypted);
        FHE.makePubliclyDecryptable(encrypted);

        userFeedback[msg.sender] = Feedback({
            encryptedMood: encrypted,
            timestamp: block.timestamp,
            isVerified: false,
            decryptedMood: 0
        });

        participants.push(msg.sender);
        emit FeedbackSubmitted(msg.sender);
    }

    function verifyFeedback(
        address user,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(!userFeedback[user].isVerified, "Feedback already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(userFeedback[user].encryptedMood);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);

        uint32 decodedMood = abi.decode(abiEncodedClearValue, (uint32));
        userFeedback[user].decryptedMood = decodedMood;
        userFeedback[user].isVerified = true;

        emit FeedbackVerified(user, decodedMood);
    }

    function getEncryptedMood(address user) external view returns (euint32) {
        return userFeedback[user].encryptedMood;
    }

    function getFeedback(address user) external view returns (
        uint256 timestamp,
        bool isVerified,
        uint32 decryptedMood
    ) {
        Feedback storage feedback = userFeedback[user];
        return (
            feedback.timestamp,
            feedback.isVerified,
            feedback.decryptedMood
        );
    }

    function getAllParticipants() external view returns (address[] memory) {
        return participants;
    }

    function computeAverageMood() external view returns (uint32) {
        uint32 totalMood;
        uint32 count;

        for (uint i = 0; i < participants.length; i++) {
            address user = participants[i];
            if (userFeedback[user].isVerified) {
                totalMood += userFeedback[user].decryptedMood;
                count++;
            }
        }

        require(count > 0, "No verified feedback available");
        return totalMood / count;
    }

    function computeMoodDistribution() external view returns (uint32[] memory) {
        uint32[] memory distribution = new uint32[](5);

        for (uint i = 0; i < participants.length; i++) {
            address user = participants[i];
            if (userFeedback[user].isVerified) {
                uint32 mood = userFeedback[user].decryptedMood;
                if (mood >= 1 && mood <= 5) {
                    distribution[mood - 1]++;
                }
            }
        }

        return distribution;
    }
}

