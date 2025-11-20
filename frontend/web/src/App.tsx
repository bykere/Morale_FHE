import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

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

interface MoraleStats {
  totalEntries: number;
  avgMorale: number;
  verifiedCount: number;
  todayEntries: number;
  highMoraleCount: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [moraleData, setMoraleData] = useState<MoraleData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingEntry, setCreatingEntry] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newEntryData, setNewEntryData] = useState({ name: "", morale: "", description: "" });
  const [selectedEntry, setSelectedEntry] = useState<MoraleData | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [userHistory, setUserHistory] = useState<MoraleData[]>([]);
  const [showFAQ, setShowFAQ] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
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

  useEffect(() => {
    if (address && moraleData.length > 0) {
      const userEntries = moraleData.filter(entry => 
        entry.creator.toLowerCase() === address.toLowerCase()
      );
      setUserHistory(userEntries);
    }
  }, [address, moraleData]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const entriesList: MoraleData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          entriesList.push({
            id: businessId,
            name: businessData.name,
            moraleScore: 0,
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
      
      setMoraleData(entriesList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createEntry = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingEntry(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating morale entry with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const moraleValue = parseInt(newEntryData.morale) || 0;
      const businessId = `morale-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, moraleValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newEntryData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        moraleValue,
        0,
        newEntryData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Morale entry created!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewEntryData({ name: "", morale: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingEntry(false); 
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
          message: "Data already verified" 
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
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified" 
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
      if (isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const getMoraleStats = (): MoraleStats => {
    const totalEntries = moraleData.length;
    const verifiedEntries = moraleData.filter(entry => entry.isVerified);
    const verifiedCount = verifiedEntries.length;
    
    const avgMorale = verifiedEntries.length > 0 
      ? verifiedEntries.reduce((sum, entry) => sum + (entry.decryptedValue || 0), 0) / verifiedEntries.length 
      : 0;
    
    const today = new Date().setHours(0,0,0,0);
    const todayEntries = moraleData.filter(entry => 
      new Date(entry.timestamp * 1000).setHours(0,0,0,0) === today
    ).length;
    
    const highMoraleCount = verifiedEntries.filter(entry => (entry.decryptedValue || 0) >= 7).length;

    return {
      totalEntries,
      avgMorale: Math.round(avgMorale * 10) / 10,
      verifiedCount,
      todayEntries,
      highMoraleCount
    };
  };

  const renderMoraleChart = () => {
    const stats = getMoraleStats();
    const verifiedEntries = moraleData.filter(entry => entry.isVerified);
    
    if (verifiedEntries.length === 0) {
      return (
        <div className="chart-placeholder">
          <div className="chart-icon">📊</div>
          <p>No verified data available for chart</p>
          <span>Submit and verify morale entries to see analytics</span>
        </div>
      );
    }

    const scoreDistribution = [0,0,0,0,0,0,0,0,0,0];
    verifiedEntries.forEach(entry => {
      const score = entry.decryptedValue || 0;
      if (score >= 1 && score <= 10) {
        scoreDistribution[score-1]++;
      }
    });

    const maxCount = Math.max(...scoreDistribution);

    return (
      <div className="morale-chart">
        <h3>Morale Score Distribution</h3>
        <div className="chart-bars">
          {scoreDistribution.map((count, index) => (
            <div key={index} className="chart-bar-container">
              <div 
                className="chart-bar" 
                style={{ height: maxCount > 0 ? `${(count / maxCount) * 100}%` : '0%' }}
              >
                <span className="bar-count">{count}</span>
              </div>
              <span className="bar-label">{index + 1}</span>
            </div>
          ))}
        </div>
        <div className="chart-stats">
          <div className="stat-item">
            <span className="stat-value">{stats.avgMorale}</span>
            <span className="stat-label">Avg Score</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{stats.highMoraleCount}</span>
            <span className="stat-label">High Morale</span>
          </div>
        </div>
      </div>
    );
  };

  const filteredData = moraleData.filter(entry =>
    entry.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    entry.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
    entry.creator.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const faqItems = [
    {
      question: "What is FHE encryption?",
      answer: "Fully Homomorphic Encryption allows computations on encrypted data without decryption, preserving privacy."
    },
    {
      question: "How is my data protected?",
      answer: "Your morale scores are encrypted on-chain and only you can decrypt them with proper authorization."
    },
    {
      question: "What can others see?",
      answer: "Others can only see encrypted data. Only with your permission can they verify decrypted values."
    },
    {
      question: "How to verify my data?",
      answer: "Click the verify button to perform offline decryption and on-chain verification."
    }
  ];

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>Team Morale FHE 🔐</h1>
            <p>Confidential Team Morale Tracking</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">😊</div>
            <h2>Connect Your Wallet to Start</h2>
            <p>Protect your team's morale data with FHE encryption while gaining valuable insights.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Submit encrypted morale entries</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>View anonymous team analytics</p>
              </div>
            </div>
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
        <p className="loading-note">Securing your team's morale data</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading morale tracking system...</p>
    </div>
  );

  const stats = getMoraleStats();

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Team Morale FHE 🔐</h1>
          <p>Encrypted Feedback • Anonymous Analytics</p>
        </div>
        
        <div className="header-actions">
          <button className="nav-btn" onClick={() => setShowFAQ(!showFAQ)}>
            {showFAQ ? "Back to App" : "FAQ"}
          </button>
          <button className="nav-btn" onClick={checkAvailability}>
            Check Status
          </button>
          <button className="create-btn" onClick={() => setShowCreateModal(true)}>
            + New Entry
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      {showFAQ ? (
        <div className="faq-section">
          <h2>Frequently Asked Questions</h2>
          <div className="faq-grid">
            {faqItems.map((item, index) => (
              <div key={index} className="faq-card">
                <h3>{item.question}</h3>
                <p>{item.answer}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="stats-section">
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-icon">📈</div>
                <div className="stat-content">
                  <h3>{stats.totalEntries}</h3>
                  <p>Total Entries</p>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon">✅</div>
                <div className="stat-content">
                  <h3>{stats.verifiedCount}</h3>
                  <p>Verified Data</p>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon">😊</div>
                <div className="stat-content">
                  <h3>{stats.avgMorale}</h3>
                  <p>Average Morale</p>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon">🎯</div>
                <div className="stat-content">
                  <h3>{stats.todayEntries}</h3>
                  <p>Today's Entries</p>
                </div>
              </div>
            </div>
          </div>

          <div className="main-content">
            <div className="content-left">
              <div className="chart-section">
                {renderMoraleChart()}
              </div>
              
              <div className="user-history">
                <h3>Your Submission History</h3>
                <div className="history-list">
                  {userHistory.slice(0, 5).map((entry, index) => (
                    <div key={index} className="history-item">
                      <span className="history-name">{entry.name}</span>
                      <span className="history-score">
                        {entry.isVerified ? `Score: ${entry.decryptedValue}` : 'Encrypted'}
                      </span>
                      <span className="history-date">
                        {new Date(entry.timestamp * 1000).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                  {userHistory.length === 0 && (
                    <div className="no-history">No submissions yet</div>
                  )}
                </div>
              </div>
            </div>
            
            <div className="content-right">
              <div className="entries-section">
                <div className="section-header">
                  <h2>Team Morale Entries</h2>
                  <div className="header-actions">
                    <input
                      type="text"
                      placeholder="Search entries..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="search-input"
                    />
                    <button onClick={loadData} disabled={isRefreshing} className="refresh-btn">
                      {isRefreshing ? "🔄" : "↻"}
                    </button>
                  </div>
                </div>
                
                <div className="entries-list">
                  {filteredData.length === 0 ? (
                    <div className="no-entries">
                      <p>No morale entries found</p>
                      <button className="create-btn" onClick={() => setShowCreateModal(true)}>
                        Create First Entry
                      </button>
                    </div>
                  ) : filteredData.map((entry, index) => (
                    <div 
                      className={`entry-item ${selectedEntry?.id === entry.id ? "selected" : ""}`}
                      key={index}
                      onClick={() => setSelectedEntry(entry)}
                    >
                      <div className="entry-header">
                        <span className="entry-name">{entry.name}</span>
                        <span className={`entry-status ${entry.isVerified ? "verified" : "encrypted"}`}>
                          {entry.isVerified ? "✅ Verified" : "🔒 Encrypted"}
                        </span>
                      </div>
                      <p className="entry-desc">{entry.description}</p>
                      <div className="entry-footer">
                        <span className="entry-creator">
                          {entry.creator.substring(0, 6)}...{entry.creator.substring(38)}
                        </span>
                        <span className="entry-date">
                          {new Date(entry.timestamp * 1000).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
      
      {showCreateModal && (
        <ModalCreateEntry 
          onSubmit={createEntry} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingEntry} 
          entryData={newEntryData} 
          setEntryData={setNewEntryData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedEntry && (
        <EntryDetailModal 
          entry={selectedEntry} 
          onClose={() => setSelectedEntry(null)} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedEntry.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
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

const ModalCreateEntry: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  entryData: any;
  setEntryData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, entryData, setEntryData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'morale') {
      const intValue = value.replace(/[^\d]/g, '');
      const numValue = parseInt(intValue) || 0;
      if (numValue >= 1 && numValue <= 10) {
        setEntryData({ ...entryData, [name]: intValue });
      } else if (intValue === '') {
        setEntryData({ ...entryData, [name]: '' });
      }
    } else {
      setEntryData({ ...entryData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-entry-modal">
        <div className="modal-header">
          <h2>New Morale Entry</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Protection</strong>
            <p>Your morale score will be encrypted with Zama FHE technology</p>
          </div>
          
          <div className="form-group">
            <label>Team/Project Name *</label>
            <input 
              type="text" 
              name="name" 
              value={entryData.name} 
              onChange={handleChange} 
              placeholder="Enter team or project name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Morale Score (1-10) *</label>
            <input 
              type="number" 
              name="morale" 
              min="1"
              max="10"
              value={entryData.morale} 
              onChange={handleChange} 
              placeholder="Enter morale score 1-10..." 
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description" 
              value={entryData.description} 
              onChange={handleChange} 
              placeholder="Optional description or context..." 
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !entryData.name || !entryData.morale} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Entry"}
          </button>
        </div>
      </div>
    </div>
  );
};

const EntryDetailModal: React.FC<{
  entry: MoraleData;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ entry, onClose, isDecrypting, decryptData }) => {
  const [localDecrypted, setLocalDecrypted] = useState<number | null>(null);

  const handleDecrypt = async () => {
    if (entry.isVerified) return;
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setLocalDecrypted(decrypted);
    }
  };

  const getMoraleEmoji = (score: number) => {
    if (score >= 9) return "😄";
    if (score >= 7) return "😊";
    if (score >= 5) return "😐";
    if (score >= 3) return "😔";
    return "😞";
  };

  return (
    <div className="modal-overlay">
      <div className="entry-detail-modal">
        <div className="modal-header">
          <h2>Morale Entry Details</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="entry-info">
            <div className="info-row">
              <span>Team Name:</span>
              <strong>{entry.name}</strong>
            </div>
            <div className="info-row">
              <span>Submitted by:</span>
              <strong>{entry.creator.substring(0, 6)}...{entry.creator.substring(38)}</strong>
            </div>
            <div className="info-row">
              <span>Date:</span>
              <strong>{new Date(entry.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            {entry.description && (
              <div className="info-row">
                <span>Description:</span>
                <p>{entry.description}</p>
              </div>
            )}
          </div>
          
          <div className="data-section">
            <h3>Encrypted Morale Data</h3>
            
            <div className="morale-display">
              <div className="morale-value">
                {entry.isVerified ? (
                  <>
                    <span className="morale-emoji">{getMoraleEmoji(entry.decryptedValue || 0)}</span>
                    <span className="score">{entry.decryptedValue}/10</span>
                    <span className="status-badge verified">On-chain Verified</span>
                  </>
                ) : localDecrypted !== null ? (
                  <>
                    <span className="morale-emoji">{getMoraleEmoji(localDecrypted)}</span>
                    <span className="score">{localDecrypted}/10</span>
                    <span className="status-badge local">Locally Decrypted</span>
                  </>
                ) : (
                  <>
                    <span className="morale-emoji">🔒</span>
                    <span className="score">Encrypted</span>
                    <span className="status-badge encrypted">FHE Protected</span>
                  </>
                )}
              </div>
              
              <button 
                className={`decrypt-btn ${entry.isVerified ? 'verified' : localDecrypted !== null ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting || entry.isVerified}
              >
                {isDecrypting ? "Decrypting..." : 
                 entry.isVerified ? "✅ Verified" : 
                 localDecrypted !== null ? "🔓 Re-verify" : 
                 "🔓 Verify Decryption"}
              </button>
            </div>
            
            <div className="fhe-explanation">
              <div className="fhe-step">
                <span>1</span>
                <p>Data encrypted with FHE technology</p>
              </div>
              <div className="fhe-step">
                <span>2</span>
                <p>Stored securely on blockchain</p>
              </div>
              <div className="fhe-step">
                <span>3</span>
                <p>Only you can decrypt with proper authorization</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!entry.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

