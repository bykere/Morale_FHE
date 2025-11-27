import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface MoraleData {
  id: string;
  name: string;
  moraleScore: number;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
  description: string;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [moraleList, setMoraleList] = useState<MoraleData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingMorale, setCreatingMorale] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newMoraleData, setNewMoraleData] = useState({ name: "", moraleScore: "", description: "" });
  const [selectedMorale, setSelectedMorale] = useState<MoraleData | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const moraleDataList: MoraleData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          moraleDataList.push({
            id: businessId,
            name: businessData.name,
            moraleScore: Number(businessData.decryptedValue) || 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            description: businessData.description
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setMoraleList(moraleDataList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createMorale = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingMorale(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating morale data with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const moraleValue = parseInt(newMoraleData.moraleScore) || 0;
      const businessId = `morale-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, moraleValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newMoraleData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        newMoraleData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Morale data created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewMoraleData({ name: "", moraleScore: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingMorale(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Contract is available and ready" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredMorale = moraleList.filter(item =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const paginatedMorale = filteredMorale.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil(filteredMorale.length / itemsPerPage);

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>Confidential Team Morale 🔐</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">😊</div>
            <h2>Connect Your Wallet to Continue</h2>
            <p>Please connect your wallet to access the confidential team morale system with FHE encryption.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading confidential morale system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Confidential Team Morale 😊</h1>
          <p>FHE Protected Team Feedback System</p>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="availability-btn">
            Check Availability
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Feedback
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="search-section">
          <input
            type="text"
            placeholder="Search feedback..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="stats-panel">
          <div className="stat-item">
            <span className="stat-value">{moraleList.length}</span>
            <span className="stat-label">Total Feedbacks</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{moraleList.filter(m => m.isVerified).length}</span>
            <span className="stat-label">Verified</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">
              {moraleList.length > 0 
                ? (moraleList.reduce((sum, m) => sum + (m.decryptedValue || 0), 0) / moraleList.length).toFixed(1)
                : "0"
              }
            </span>
            <span className="stat-label">Avg Morale</span>
          </div>
        </div>

        <div className="morale-list">
          {paginatedMorale.length === 0 ? (
            <div className="no-data">
              <p>No morale feedback found</p>
              <button onClick={() => setShowCreateModal(true)} className="create-btn">
                Create First Feedback
              </button>
            </div>
          ) : (
            paginatedMorale.map((morale, index) => (
              <div 
                className={`morale-item ${morale.isVerified ? 'verified' : ''}`}
                key={index}
                onClick={() => setSelectedMorale(morale)}
              >
                <div className="morale-header">
                  <h3>{morale.name}</h3>
                  <span className={`status ${morale.isVerified ? 'verified' : 'pending'}`}>
                    {morale.isVerified ? '✅ Verified' : '🔓 Pending'}
                  </span>
                </div>
                <p className="description">{morale.description}</p>
                <div className="morale-footer">
                  <span>Score: {morale.isVerified ? morale.decryptedValue : '🔒'}</span>
                  <span>{new Date(morale.timestamp * 1000).toLocaleDateString()}</span>
                </div>
              </div>
            ))
          )}
        </div>

        {totalPages > 1 && (
          <div className="pagination">
            <button 
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
            >
              Previous
            </button>
            <span>Page {currentPage} of {totalPages}</span>
            <button 
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              disabled={currentPage === totalPages}
            >
              Next
            </button>
          </div>
        )}

        <div className="fhe-info-panel">
          <h3>FHE Protection Process</h3>
          <div className="fhe-steps">
            <div className="step">
              <span>1</span>
              <p>Encrypt morale score using Zama FHE</p>
            </div>
            <div className="step">
              <span>2</span>
              <p>Store encrypted data on-chain</p>
            </div>
            <div className="step">
              <span>3</span>
              <p>Offline decryption with proof generation</p>
            </div>
            <div className="step">
              <span>4</span>
              <p>On-chain verification using FHE.checkSignatures</p>
            </div>
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateMorale 
          onSubmit={createMorale} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingMorale} 
          moraleData={newMoraleData} 
          setMoraleData={setNewMoraleData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedMorale && (
        <MoraleDetailModal 
          morale={selectedMorale} 
          onClose={() => setSelectedMorale(null)} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedMorale.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateMorale: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  moraleData: any;
  setMoraleData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, moraleData, setMoraleData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'moraleScore') {
      const intValue = value.replace(/[^\d]/g, '');
      setMoraleData({ ...moraleData, [name]: intValue });
    } else {
      setMoraleData({ ...moraleData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>New Team Morale Feedback</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Protection</strong>
            <p>Morale score will be encrypted with Zama FHE (Integer only)</p>
          </div>
          
          <div className="form-group">
            <label>Team/Project Name *</label>
            <input 
              type="text" 
              name="name" 
              value={moraleData.name} 
              onChange={handleChange} 
              placeholder="Enter team or project name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Morale Score (1-10) *</label>
            <input 
              type="number" 
              min="1" 
              max="10" 
              name="moraleScore" 
              value={moraleData.moraleScore} 
              onChange={handleChange} 
              placeholder="Enter morale score..." 
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Feedback Description *</label>
            <textarea 
              name="description" 
              value={moraleData.description} 
              onChange={handleChange} 
              placeholder="Enter your feedback..." 
              rows={3}
            />
            <div className="data-type-label">Public Data</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !moraleData.name || !moraleData.moraleScore || !moraleData.description} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Submitting..." : "Submit Feedback"}
          </button>
        </div>
      </div>
    </div>
  );
};

const MoraleDetailModal: React.FC<{
  morale: MoraleData;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ morale, onClose, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    await decryptData();
  };

  return (
    <div className="modal-overlay">
      <div className="detail-modal">
        <div className="modal-header">
          <h2>Morale Feedback Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="info-grid">
            <div className="info-item">
              <label>Team/Project:</label>
              <span>{morale.name}</span>
            </div>
            <div className="info-item">
              <label>Creator:</label>
              <span>{morale.creator.substring(0, 6)}...{morale.creator.substring(38)}</span>
            </div>
            <div className="info-item">
              <label>Date:</label>
              <span>{new Date(morale.timestamp * 1000).toLocaleDateString()}</span>
            </div>
            <div className="info-item">
              <label>Morale Score:</label>
              <span>
                {morale.isVerified ? 
                  `${morale.decryptedValue}/10 (Verified)` : 
                  "🔒 Encrypted (Click to verify)"
                }
              </span>
            </div>
          </div>
          
          <div className="description-section">
            <label>Feedback:</label>
            <p>{morale.description}</p>
          </div>
          
          <div className="verification-section">
            <button 
              className={`verify-btn ${morale.isVerified ? 'verified' : ''}`}
              onClick={handleDecrypt} 
              disabled={isDecrypting}
            >
              {isDecrypting ? "Verifying..." : 
               morale.isVerified ? "✅ Verified On-chain" : "🔓 Verify Decryption"}
            </button>
            
            {morale.isVerified && (
              <div className="verification-success">
                <p>✅ This feedback has been successfully verified on-chain using FHE signatures.</p>
              </div>
            )}
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;