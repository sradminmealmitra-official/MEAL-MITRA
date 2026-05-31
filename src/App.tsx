import React, { useState, useEffect, useRef } from 'react';
import { 
  QrCode, 
  Send, 
  CheckCircle2, 
  AlertTriangle, 
  HelpCircle, 
  RefreshCw, 
  PlusCircle, 
  Database, 
  Smartphone, 
  FileSpreadsheet, 
  Check, 
  X, 
  Undo2, 
  Info,
  Layers,
  Sparkles,
  ExternalLink,
  Laptop
} from 'lucide-react';
import QRCode from 'qrcode';
import { initAuth, googleSignIn, logout } from './lib/firebaseAuth';
import { createNewSpreadsheet, readOrdersFromSpreadsheet, syncSingleOrderToSpreadsheet, bulkSyncOrdersToSpreadsheet } from './lib/sheetsService';

// Interface matching /src/types.ts and backend server.ts
interface TiffinOrder {
  tiffinId: string;
  orderId: string;
  memberId: string;
  customerName: string;
  mobileNumber: string;
  otp: string;
  status: 'Pending' | 'Dispatched' | 'Received';
  scanCount: number;
  lastScannedAt?: string;
  dispatchedAt?: string;
  receivedAt?: string;
}

interface SheetsConfig {
  useMock: boolean;
  sheetsId: string;
  appsScriptUrl: string;
}

export default function App() {
  // Application states
  const [tiffins, setTiffins] = useState<TiffinOrder[]>([]);
  const [activeTiffin, setActiveTiffin] = useState<TiffinOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  
  // URL routing state
  const [urlTiffinId, setUrlTiffinId] = useState<string | null>(null);
  
  // Manual OTP input state
  const [enteredOtp, setEnteredOtp] = useState('');
  const [sealConfirmed, setSealConfirmed] = useState(false);
  const [submittingVerification, setSubmittingVerification] = useState(false);
  
  // Floating simulator state
  const [selectedSimTiffinId, setSelectedSimTiffinId] = useState<string>('TIF-101');
  const [isSimulatorOpen, setIsSimulatorOpen] = useState(true);
  const [simActiveTab, setSimActiveTab] = useState<'mobile' | 'kitchen'>('mobile');

  // Google Sheets Config State
  const [sheetsConfig, setSheetsConfig] = useState<SheetsConfig>({
    useMock: true,
    sheetsId: '',
    appsScriptUrl: ''
  });
  const [savingConfig, setSavingConfig] = useState(false);
  const [gapiToken, setGapiToken] = useState<string | null>(null);
  const [isConnectedToRealSheets, setIsConnectedToRealSheets] = useState(false);
  const [qrBaseUrl, setQrBaseUrl] = useState<string>(() => {
    const saved = localStorage.getItem('tiffintrace_qr_base_url');
    if (saved) return saved;
    // Default fallback to window.location.origin
    return window.location.origin;
  });

  // New Tiffin Form State
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTiffinId, setNewTiffinId] = useState('');
  const [newOrderId, setNewOrderId] = useState('');
  const [newMemberId, setNewMemberId] = useState('');
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newMobile, setNewMobile] = useState('');
  const [newOtp, setNewOtp] = useState('');

  // Local storage for keeping track of scans simulated in the session
  const [historyLogs, setHistoryLogs] = useState<Array<{time: string, text: string, type: 'info' | 'success' | 'warning' | 'error'}>>([]);

  // Generate QR code details helper
  const [qrCache, setQrCache] = useState<Record<string, string>>({});

  // Parse Tiffin ID from URL if scanned/opened directly
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tId = params.get('tiffinId') || params.get('qr');
    if (tId) {
      setUrlTiffinId(tId.toUpperCase());
      fetchActiveTiffin(tId.toUpperCase(), true); // Load details and trigger SCAN increment
    } else {
      fetchTiffins();
    }
    fetchSheetsConfig();

    // Initialize Firebase Auth
    initAuth(
      (user, token) => {
        setGapiToken(token);
        setIsConnectedToRealSheets(true);
        // We log the success message to the live log
        const time = new Date().toLocaleTimeString();
        setHistoryLogs(prev => [{ time, text: `Google Account authenticated: ${user.email}`, type: 'success' }, ...prev]);
      },
      () => {
        setGapiToken(null);
        setIsConnectedToRealSheets(false);
      }
    );
  }, []);

  // Sync QR generation cache when orders or base URL change
  useEffect(() => {
    const updateQRCodes = async () => {
      const newCache: Record<string, string> = { ...qrCache };
      let changed = false;
      
      for (const tiffin of tiffins) {
        const baseUrlClean = qrBaseUrl.replace(/\/$/, "");
        const url = `${baseUrlClean}?tiffinId=${tiffin.tiffinId}`;
        const expectedUrlKey = `url_${tiffin.tiffinId}`;
        
        if (!qrCache[tiffin.tiffinId] || localStorage.getItem(expectedUrlKey) !== url) {
          try {
            const urlData = await new Promise<string>((resolve, reject) => {
              QRCode.toDataURL(url, { margin: 1, scale: 5 }, (err, data) => {
                if (err) reject(err);
                else resolve(data);
              });
            });
            newCache[tiffin.tiffinId] = urlData;
            localStorage.setItem(expectedUrlKey, url);
            changed = true;
          } catch (err) {
            console.error('Error generating QR code:', err);
          }
        }
      }
      
      if (changed || Object.keys(newCache).length !== Object.keys(qrCache).length) {
        setQrCache(newCache);
      }
    };

    updateQRCodes();
  }, [tiffins, qrBaseUrl]);

  // Log action to panel
  const logAction = (text: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    const time = new Date().toLocaleTimeString();
    setHistoryLogs(prev => [{ time, text, type }, ...prev]);
  };

  // Fetch all tiffins from database
  const fetchTiffins = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/tiffins');
      if (!res.ok) throw new Error('Failed to fetch from server');
      const data = await res.json();
      setTiffins(data);
      setErrorMsg(null);
    } catch (err: any) {
      console.error(err);
      setErrorMsg('Could not fetch active tiffins from local express backend.');
    } finally {
      setLoading(false);
    }
  };

  // Fetch configuration
  const fetchSheetsConfig = async () => {
    try {
      const res = await fetch('/api/sheets-config');
      if (res.ok) {
        const data = await res.json();
        setSheetsConfig(data);
      }
    } catch (e) {
      console.error('Error fetching sheets config', e);
    }
  };

  // Fetch a single tiffin by ID, with optional increment of scanCount on opening
  const fetchActiveTiffin = async (id: string, isScan = false) => {
    try {
      setLoading(true);
      const res = await fetch(`/api/tiffins/${id}${isScan ? '?scan=true' : ''}`);
      if (!res.ok) throw new Error('Failed to retrieve tiffin');
      const data = await res.json();
      setActiveTiffin(data);
      
      // If it's scan loading, log it visually
      if (isScan) {
        logAction(`QR Scanned: Tiffin ${id}. Scan Sequence: #${data.scanCount}.`, data.scanCount > 2 ? 'error' : 'info');
      }
      
      // Update our list view if we also have it behind
      fetchTiffins();
    } catch (err: any) {
      setErrorMsg('Error fetching specific tiffin dispatch profile.');
    } finally {
      setLoading(false);
    }
  };

  // Dispatch standard tiffin from kitchen
  const handleDispatch = async (id: string) => {
    try {
      const res = await fetch(`/api/tiffins/${id}/dispatch`, { method: 'POST' });
      if (!res.ok) throw new Error('Dispatch action failed');
      const updated = await res.json();
      
      // If we are showing standalone view, update active
      if (activeTiffin && activeTiffin.tiffinId === id) {
        setActiveTiffin(updated);
      }
      
      fetchTiffins();
      logAction(`Kitchen: Tiffin ${id} marked as DISPATCHED. Packed with Secure Seal.`, 'success');
      setSuccessMsg('Tiffin successfully marked as Dispatched from Kitchen!');
      setTimeout(() => setSuccessMsg(null), 4000);

      // Real-time synchronization callback for Google Sheets if connected
      if (isConnectedToRealSheets && sheetsConfig.sheetsId) {
        syncToRealGoogleSheet(updated);
      }
    } catch (e) {
      setErrorMsg('Failed to process kitchen dispatch.');
    }
  };

  // Reversible Undo Dispatch action
  const handleUndoDispatch = async (id: string) => {
    try {
      const res = await fetch(`/api/tiffins/${id}/undispatch`, { method: 'POST' });
      if (!res.ok) throw new Error('Undo dispatch action failed');
      const updated = await res.json();
      
      if (activeTiffin && activeTiffin.tiffinId === id) {
        setActiveTiffin(updated);
      }
      
      fetchTiffins();
      logAction(`Kitchen: Dispatch UNDONE for Tiffin ${id}. Reverted back to Pending.`, 'warning');
      setSuccessMsg('Kitchen dispatch undone. Scan sequence reset to 0.');
      setTimeout(() => setSuccessMsg(null), 4000);

      if (isConnectedToRealSheets && sheetsConfig.sheetsId) {
        syncToRealGoogleSheet(updated);
      }
    } catch (e) {
      setErrorMsg('Failed to undo dispatch.');
    }
  };

  // Receive tiffin verification
  const handleMarkReceived = async (id: string) => {
    if (!enteredOtp) {
      setErrorMsg('Please enter the 6-digit confirmation OTP sent to customer mobile.');
      return;
    }
    if (!sealConfirmed) {
      setErrorMsg('Please review and check the seal confirmation checkbox first.');
      return;
    }

    setSubmittingVerification(true);
    setErrorMsg(null);

    try {
      const res = await fetch(`/api/tiffins/${id}/receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otp: enteredOtp.trim(), confirmSeal: sealConfirmed })
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || 'Verification failed');
      }

      setActiveTiffin(result.tiffin);
      fetchTiffins();
      logAction(`Customer: Tiffin ${id} received with valid OTP & sealed paper joint.`, 'success');
      setSuccessMsg('Security Handover Verified! Record fully synced.');
      
      // Sync with real-world Google Sheet rows if connected
      if (isConnectedToRealSheets && sheetsConfig.sheetsId) {
        syncToRealGoogleSheet(result.tiffin);
      }

      setEnteredOtp('');
      setSealConfirmed(false);
    } catch (e: any) {
      setErrorMsg(e.message || 'Verification failed. OTP code might be incorrect.');
    } finally {
      setSubmittingVerification(false);
    }
  };

  // Reset a single tiffin scan history
  const handleResetTiffin = async (id: string) => {
    try {
      const res = await fetch(`/api/tiffins/${id}/reset`, { method: 'POST' });
      if (!res.ok) throw new Error('Reset failed');
      const updated = await res.json();
      
      if (activeTiffin && activeTiffin.tiffinId === id) {
        setActiveTiffin(updated);
      }
      
      fetchTiffins();
      logAction(`Reset: Tiffin ${id} tracing records completely reset.`, 'info');
      setSuccessMsg(`Tiffin ${id} reset to brand-new unscanned profile.`);
      setTimeout(() => setSuccessMsg(null), 3000);

      if (isConnectedToRealSheets && sheetsConfig.sheetsId) {
        syncToRealGoogleSheet(updated);
      }
    } catch (e) {
      setErrorMsg('Could not reset selected tiffin record.');
    }
  };

  // Add custom tiffin dispatch
  const handleAddTiffinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTiffinId) return;

    try {
      const bodyPayload = {
        tiffinId: newTiffinId.toUpperCase(),
        orderId: newOrderId || `ORD-${Math.floor(1000 + Math.random() * 9000)}`,
        memberId: newMemberId || `MEM-${Math.floor(1000 + Math.random() * 9000)}`,
        customerName: newCustomerName || 'Valued Subscriber',
        mobileNumber: newMobile || '9876543210',
        otp: newOtp || String(Math.floor(100000 + Math.random() * 900000)),
        status: 'Pending',
        scanCount: 0
      };

      const res = await fetch('/api/tiffins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload)
      });

      if (!res.ok) throw new Error('Creation failed');
      
      logAction(`Database: Added new Tiffin ${bodyPayload.tiffinId} for customer ${bodyPayload.customerName}.`, 'success');
      setShowAddForm(false);
      
      // Clear inputs
      setNewTiffinId('');
      setNewOrderId('');
      setNewMemberId('');
      setNewCustomerName('');
      setNewMobile('');
      setNewOtp('');
      
      fetchTiffins();

      if (isConnectedToRealSheets && sheetsConfig.sheetsId) {
        syncToRealGoogleSheet(bodyPayload as any);
      }
    } catch (err) {
      setErrorMsg('Error creating custom order.');
    }
  };

  // Google Sheets Config Save
  const saveSheetsConfig = async (newConfig: SheetsConfig) => {
    try {
      setSavingConfig(true);
      const res = await fetch('/api/sheets-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig)
      });
      if (res.ok) {
        setSheetsConfig(newConfig);
        logAction(`Google Sheets config updated. UseMock: ${newConfig.useMock ? 'YES' : 'NO'}`);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSavingConfig(false);
    }
  };

  // Connect Google account and setup sheet
  const handleConnectGoogleDrive = async () => {
    try {
      setLoading(true);
      logAction('Authenticating with Google Account...', 'info');
      const result = await googleSignIn();
      if (result) {
        setGapiToken(result.accessToken);
        setIsConnectedToRealSheets(true);
        logAction(`Successfully authenticated as ${result.user.email}!`, 'success');
        
        let targetId = sheetsConfig.sheetsId;
        if (!targetId || targetId === '1aBcD_EXAMPLE_SHEET_ID_990141' || targetId === '') {
          const confirmed = window.confirm(
            'Would you like TiffinTrace to automatically create a brand-new "TiffinTrace Secure Delivery Register" spreadsheet in your Google Sheets account?'
          );
          if (confirmed) {
            logAction('Creating a new Google Spreadsheet...', 'info');
            const newSheet = await createNewSpreadsheet(result.accessToken);
            targetId = newSheet.id;
            logAction(`Created and ready! Spreadsheet ID: ${newSheet.id}`, 'success');
            
            // Sync all existing tiffins into this sheet as a starting dataset!
            await bulkSyncOrdersToSpreadsheet(result.accessToken, newSheet.id, tiffins);
            logAction('Synchronized all local courier records initially to the new sheet!', 'success');
          } else {
            const manualId = window.prompt(
              'Please enter your existing Google Spreadsheet ID (from its URL):'
            );
            if (manualId) {
              targetId = manualId.trim();
            } else {
              targetId = '';
            }
          }
        }

        const newCfg = {
          ...sheetsConfig,
          useMock: false,
          sheetsId: targetId
        };
        await saveSheetsConfig(newCfg);
      }
    } catch (e: any) {
      console.error(e);
      setErrorMsg(`Google Authentication failed: ${e.message || e}`);
      logAction(`Authentication failed: ${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnectGoogleDrive = async () => {
    try {
      setLoading(true);
      await logout();
      setGapiToken(null);
      setIsConnectedToRealSheets(false);
      await saveSheetsConfig({
        ...sheetsConfig,
        useMock: true,
        sheetsId: ''
      });
      logAction('Disconnected Google account and reset to local mock state.', 'info');
    } catch (e: any) {
      console.error(e);
      setErrorMsg(`Disconnect failed: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  const pullFromGoogleSheet = async () => {
    if (!sheetsConfig.sheetsId || !gapiToken) {
      setErrorMsg('No active connected spreadsheet or login token found!');
      return;
    }
    try {
      setLoading(true);
      logAction('Pulling active rows from Connected Google Spreadsheet...', 'info');
      const loadedOrders = await readOrdersFromSpreadsheet(gapiToken, sheetsConfig.sheetsId);
      
      // Save them online to local database so they are persistent
      for (const order of loadedOrders) {
        if (!order.tiffinId) continue;
        await fetch('/api/tiffins', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(order)
        });
      }
      
      await fetchTiffins();
      logAction(`Successfully imported ${loadedOrders.length} courier orders from Google Sheet!`, 'success');
      setSuccessMsg(`Imported ${loadedOrders.length} active orders directly from Google Sheet.`);
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (e: any) {
      console.error(e);
      setErrorMsg(`Import failed: ${e.message || e}`);
      logAction(`Sheet import failed: ${e.message || e}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const pushToGoogleSheet = async () => {
    if (!sheetsConfig.sheetsId || !gapiToken) {
      setErrorMsg('No active connected spreadsheet or login token found!');
      return;
    }
    const confirmed = window.confirm(
      'Are you sure you want to push all local database records to Google Sheets? This will overwrite the spreadsheet rows below the headers.'
    );
    if (!confirmed) return;

    try {
      setLoading(true);
      logAction('Pushing local operations database to Google Sheet rows...', 'info');
      await bulkSyncOrdersToSpreadsheet(gapiToken, sheetsConfig.sheetsId, tiffins);
      logAction('✓ Completed! Spreadsheet successfully overwritten with local dataset.', 'success');
      setSuccessMsg('Bulk push to Google Sheet succeeded!');
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (e: any) {
      console.error(e);
      setErrorMsg(`Bulk sync failed: ${e.message || e}`);
      logAction(`Sheet sync failed: ${e.message || e}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const syncToRealGoogleSheet = async (tiffinRow: TiffinOrder) => {
    if (!isConnectedToRealSheets || !sheetsConfig.sheetsId || !gapiToken) {
      logAction(`[Mock Synced] Real-time item updated in cache for ${tiffinRow.tiffinId}.`, 'info');
      return;
    }
    
    try {
      logAction(`Syncing cell variables to Google Sheet for ${tiffinRow.tiffinId}...`, 'info');
      await syncSingleOrderToSpreadsheet(gapiToken, sheetsConfig.sheetsId, tiffinRow);
      logAction(`✓ Clean sync: Row updated inside Google Sheet for ${tiffinRow.tiffinId}.`, 'success');
    } catch (e: any) {
      console.error('Real-time sheets sync error:', e);
      logAction(`Sync failed for ${tiffinRow.tiffinId}: ${e.message || e}`, 'error');
    }
  };

  // Standalone Individual view renderer (runs when urlTiffinId is present)
  if (urlTiffinId) {
    const displayTiffin = activeTiffin || tiffins.find(t => t.tiffinId === urlTiffinId);

    return (
      <div className="min-h-screen bg-[#FAF7F2] text-[#4A3728] font-sans flex flex-col items-center justify-between py-10 px-4 relative">
        <header className="w-full max-w-md mx-auto text-center mb-8">
          <div className="flex justify-center items-center gap-2 mb-2">
            <div className="w-8 h-8 bg-[#7D8F69] rounded-lg flex items-center justify-center text-white">
              <Layers className="w-4 h-4" />
            </div>
            <span className="text-xl font-serif text-[#2C1810] font-bold">SecureTiffin Auth</span>
          </div>
          <p className="text-xs text-[#8C8275] uppercase tracking-wider font-semibold">Joint Paper-Tape Seal Protocol</p>
        </header>

        <main className="w-full max-w-md bg-white rounded-[32px] border border-[#E5E0D8] p-8 shadow-sm flex-1 flex flex-col justify-center">
          {!displayTiffin ? (
            <div className="text-center py-10">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto text-[#7D8F69] mb-4" />
              <p className="font-bold">Retrieving Tiffin QR Code record...</p>
              <p className="text-xs text-[#8C8275] mt-2">Checking Google Sheets & system indexes</p>
            </div>
          ) : (
            <>
              {/* STAGE 1: FIRST SCAN - KITCHEN DISPATCH */}
              {displayTiffin.scanCount <= 1 && displayTiffin.status === 'Pending' && (
                <div id="kitchen-dispatch-screen" className="flex flex-col gap-6 animate-fade-in">
                  <div className="text-center">
                    <span className="inline-block px-3 py-1 bg-[#F5F1EB] text-[#8C8275] text-[10px] uppercase tracking-wider font-bold rounded-full mb-3">
                      Scan Sequence: 01 (Kitchen)
                    </span>
                    <h1 className="text-3xl font-serif text-[#2C1810] mb-2">Dispatch Order</h1>
                    <p className="text-xs text-[#8C8275] max-w-sm mx-auto">
                      Initiate the secure delivery loop. Verify information and seal the box with unbroken joint paper tape before dispatching.
                    </p>
                  </div>

                  <div className="bg-[#FAF7F2] border border-[#E5E0D8] rounded-2xl p-5 space-y-3">
                    <div className="flex justify-between border-b border-[#E5E0D8] pb-2 text-sm">
                      <span className="text-[#8C8275]">Tiffin Container</span>
                      <strong className="font-mono text-[#2C1810]">{displayTiffin.tiffinId}</strong>
                    </div>
                    <div className="flex justify-between border-b border-[#E5E0D8] pb-2 text-sm">
                      <span className="text-[#8C8275]">Subscriber</span>
                      <span className="font-semibold">{displayTiffin.customerName}</span>
                    </div>
                    <div className="flex justify-between border-b border-[#E5E0D8] pb-2 text-sm">
                      <span className="text-[#8C8275]">Subscriber ID</span>
                      <span className="font-mono">{displayTiffin.memberId}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-[#8C8275]">Order Identifier</span>
                      <span className="font-mono font-semibold">{displayTiffin.orderId}</span>
                    </div>
                  </div>

                  {successMsg && (
                    <div className="bg-[#F4F9F1] border border-[#D5E6CD] text-[#587247] text-xs p-3 rounded-xl text-center flex items-center justify-center gap-2">
                      <Check className="w-4 h-4" /> {successMsg}
                    </div>
                  )}

                  <button
                    id="btn-mark-dispatched"
                    onClick={() => handleDispatch(displayTiffin.tiffinId)}
                    className="w-full bg-[#7D8F69] hover:bg-[#6A7B58] text-white py-4 rounded-xl font-semibold shadow-md transition-colors flex items-center justify-center gap-2 text-sm"
                  >
                    <Send className="w-4 h-4" /> Mark as Dispatched
                  </button>
                  
                  <div className="text-center text-[10px] text-[#8C8275] leading-relaxed">
                    Once clicked, customer receives notification and OTP code is assigned. Scan sequence transitions automatically.
                  </div>
                </div>
              )}

              {/* STAGE 1 UNDOABLE BUFFER: DISPATCHED, BUT WE ARE IN STANDALONE KITCHEN PANEL (STILL SCAN COUNT 1 AND STATUS DISPATCHED) */}
              {displayTiffin.scanCount === 1 && displayTiffin.status === 'Dispatched' && (
                <div id="kitchen-undo-screen" className="flex flex-col gap-6 animate-fade-in text-center">
                  <div className="w-16 h-16 bg-[#F5F1EB] rounded-full flex items-center justify-center mx-auto text-[#7D8F69]">
                    <CheckCircle2 className="w-8 h-8" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-serif text-[#2C1810]">Dispatched Successfully</h1>
                    <p className="text-xs text-[#8C8275] mt-2">
                      Awaiting Customer Scan (Sequence 02) to perform final verification.
                    </p>
                  </div>

                  <div className="bg-[#FAF7F2] border border-[#E5E0D8] rounded-2xl p-4 text-xs text-left text-[#8C8275] space-y-2">
                    <p><strong>Tiffin Status:</strong> Out for Delivery</p>
                    <p><strong>Dispatched At:</strong> {displayTiffin.dispatchedAt ? new Date(displayTiffin.dispatchedAt).toLocaleTimeString() : 'Just now'}</p>
                    <p><strong>Verification Code:</strong> Securely recorded inside Google Sheets.</p>
                  </div>

                  <button
                    id="btn-undo-dispatch"
                    onClick={() => handleUndoDispatch(displayTiffin.tiffinId)}
                    className="text-xs text-[#BC6C25] font-semibold flex items-center justify-center gap-1 hover:underline"
                  >
                    <Undo2 className="w-3.5 h-3.5" /> Made a mistake? Undo Dispatch
                  </button>

                  <hr className="border-[#E5E0D8]" />

                  {/* Simulate customer scanning to proceed */}
                  <div>
                    <button
                      onClick={() => fetchActiveTiffin(displayTiffin.tiffinId, true)}
                      className="text-[11px] bg-[#BC6C25]/10 text-[#BC6C25] px-3 py-1.5 rounded-full font-medium hover:bg-[#BC6C25]/20 transition-all border border-[#BC6C25]/20"
                    >
                      📱 Simulate Customer Scan (Sequence 02)
                    </button>
                  </div>
                </div>
              )}

              {/* STAGE 2: SECOND SCAN - CUSTOMER DELIVERY & OTP VERIFICATION */}
              {displayTiffin.scanCount === 2 && displayTiffin.status === 'Dispatched' && (
                <div id="customer-verification-screen" className="flex flex-col gap-6 animate-fade-in">
                  <div className="text-center">
                    <span className="inline-block px-3 py-1 bg-[#FBF2EB] text-[#BC6C25] text-[10px] uppercase tracking-wider font-bold rounded-full mb-3">
                      Scan Sequence: 02 (Customer Receipt)
                    </span>
                    <h1 className="text-3xl font-serif text-[#2C1810] mb-1">Verify Delivery</h1>
                    <p className="text-xs text-[#8C8275]">
                      Review the seal integrity and enter the OTP code to accept your meal handover.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-[#FAF7F2] p-3 rounded-xl border border-[#E5E0D8] text-center">
                      <p className="text-[9px] uppercase tracking-wider text-[#8C8275] mb-0.5">Member ID</p>
                      <strong className="font-mono text-[#2C1810] text-sm">{displayTiffin.memberId}</strong>
                    </div>
                    <div className="bg-[#FAF7F2] p-3 rounded-xl border border-[#E5E0D8] text-center">
                      <p className="text-[9px] uppercase tracking-wider text-[#8C8275] mb-0.5">Order ID</p>
                      <strong className="font-mono text-[#2C1810] text-sm">{displayTiffin.orderId}</strong>
                    </div>
                  </div>

                  {errorMsg && (
                    <div className="bg-[#FDF2F2] border border-[#FDE2E2] text-[#9A2121] text-xs p-3 rounded-xl text-center">
                      ⚠️ {errorMsg}
                    </div>
                  )}

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-[#8C8275] mb-1.5">
                        6-Digit OTP Code
                      </label>
                      <input
                        id="input-otp"
                        type="text"
                        maxLength={6}
                        value={enteredOtp}
                        onChange={(e) => setEnteredOtp(e.target.value.replace(/\D/g, ''))}
                        placeholder="• • • • • •"
                        className="w-full bg-[#FAF7F2] border-2 border-[#E5E0D8] rounded-xl py-3 text-center text-xl tracking-[0.5em] focus:outline-none focus:border-[#7D8F69] text-[#2C1810] font-bold"
                      />
                      <p className="text-[10px] text-[#8C8275] mt-1 text-center">
                        Note: For testing, the active OTP code database record is: <strong className="font-mono text-xs text-[#2C1810] bg-[#FAF7F2] px-1">{displayTiffin.otp}</strong>
                      </p>
                    </div>

                    <label className="flex items-start gap-3 p-3.5 bg-[#F5F1EB]/70 rounded-xl cursor-pointer border border-[#E5E0D8] hover:bg-[#F5F1EB] transition-colors">
                      <input
                        id="checkbox-seal"
                        type="checkbox"
                        checked={sealConfirmed}
                        onChange={(e) => setSealConfirmed(e.target.checked)}
                        className="mt-0.5 w-4 h-4 rounded text-[#7D8F69] focus:ring-[#7D8F69] border-[#E5E0D8]"
                      />
                      <span className="text-xs leading-relaxed text-[#4A3728]">
                        I confirm that the thali/tiffin box is <strong>sealed with a single joint paper tape seal</strong> and a QR code the joint is undamaged and has not been tampered with.
                      </span>
                    </label>

                    <button
                      id="btn-mark-received"
                      onClick={() => handleMarkReceived(displayTiffin.tiffinId)}
                      disabled={submittingVerification}
                      className="w-full bg-[#7D8F69] hover:bg-[#6A7B58] text-white py-4 rounded-xl font-bold shadow-md transition-colors flex items-center justify-center gap-2 text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {submittingVerification ? 'Syncing...' : 'Mark Order Received & Verify'}
                    </button>
                  </div>
                </div>
              )}

              {/* STAGE 3: ORDER RECEPTION COMPLETED SUCCESS BLOCK */}
              {displayTiffin.status === 'Received' && displayTiffin.scanCount <= 2 && (
                <div id="customer-success-screen" className="flex flex-col gap-6 animate-fade-in text-center py-4">
                  <div className="w-16 h-16 bg-[#F4F9F1] text-[#7D8F69] rounded-full flex items-center justify-center mx-auto shadow-sm">
                    <Check className="w-8 h-8 stroke-[3]" />
                  </div>
                  <div>
                    <h1 className="text-3xl font-serif text-[#2C1810] mb-2">Handover Complete</h1>
                    <p className="text-xs text-[#8C8275] max-w-sm mx-auto">
                      Thank you for verifying! Your secure receipt status has been synchronized immediately with our central Google Sheets hub in real-time.
                    </p>
                  </div>

                  <div className="bg-[#F5F1EB]/50 border border-[#E5E0D8] rounded-2xl p-5 space-y-2 text-xs text-left">
                    <div className="flex justify-between border-b border-[#E5E0D8]/40 pb-1.5">
                      <span className="text-[#8C8275]">Subscriber</span>
                      <strong>{displayTiffin.customerName}</strong>
                    </div>
                    <div className="flex justify-between border-b border-[#E5E0D8]/40 pb-1.5">
                      <span className="text-[#8C8275]">Seal Integrity</span>
                      <span className="text-[#7D8F69] font-medium">✓ Intact / Unbroken Verified</span>
                    </div>
                    <div className="flex justify-between border-b border-[#E5E0D8]/40 pb-1.5">
                      <span className="text-[#8C8275]">Synced To Sheet</span>
                      <span className="text-[#7D8F69] font-mono">Row State Updated</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8C8275]">Completion Time</span>
                      <span>{displayTiffin.receivedAt ? new Date(displayTiffin.receivedAt).toLocaleTimeString() : 'Just now'}</span>
                    </div>
                  </div>

                  <hr className="border-[#E5E0D8]" />

                  <div>
                    <button
                      onClick={() => handleResetTiffin(displayTiffin.tiffinId)}
                      className="text-xs text-[#8C8275] border border-[#E5E0D8] px-3 py-1.5 rounded-lg hover:bg-[#FAF7F2] hover:text-[#2C1810] transition-colors"
                    >
                      🔄 Reset Scan State to Unscanned (For Testing)
                    </button>
                  </div>
                </div>
              )}

              {/* STAGE 4: SCAN COUNT > 2 - CRITICAL DANGER TAMPER ALERT */}
              {displayTiffin.scanCount > 2 && (
                <div id="tamper-alert-screen" className="flex flex-col gap-6 animate-fade-in py-2">
                  <div className="bg-[#FEF2F2] border border-[#FEE2E2] rounded-2xl p-6 text-center">
                    <div className="w-12 h-12 bg-[#FEE2E2] text-[#991B1B] rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce">
                      <AlertTriangle className="w-6 h-6" />
                    </div>
                    <h2 className="text-[#991B1B] text-xl font-bold uppercase tracking-wider mb-2">
                      ⚠️ WARNING - Invalid Scan
                    </h2>
                    <p className="text-xs text-[#991B1B] leading-relaxed">
                      QR already scanned and marked for delivery, contact support before receiving/ Don't accept it. This container has run out of verify attempts.
                    </p>
                  </div>

                  <div className="border border-[#E5E0D8] rounded-xl p-4 text-xs space-y-2 bg-white">
                    <p className="text-[#8C8275] font-bold uppercase tracking-wider text-[9px]">Security Record Log</p>
                    <p className="text-[#4A3728]">
                      <strong>Tiffin Identifier:</strong> <span className="font-mono">{displayTiffin.tiffinId}</span>
                    </p>
                    <p className="text-[#4A3728]">
                      <strong>Total Scan Frequency:</strong> <span className="bg-[#FEF2F2] text-[#991B1B] px-1.5 py-0.5 rounded font-bold">{displayTiffin.scanCount} scans tracked</span>
                    </p>
                    <p className="text-[#4A3728] text-[11px]">
                      <strong>Last Scanned At:</strong> {displayTiffin.lastScannedAt ? new Date(displayTiffin.lastScannedAt).toLocaleString() : 'Just now'}
                    </p>
                    <p className="text-[#4A3728] text-[11px]">
                      <strong>Current status state:</strong> {displayTiffin.status}
                    </p>
                  </div>

                  <a
                    href="https://wa.me/918917873032?text=EMERGENCY%21%20Tiffin%20container%20scanned%20more%20than%20twice%20and%20warned%20as%20tampered.%20Tiffin%20ID%3A%20"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full bg-[#E11D48] hover:bg-[#BE123C] text-white py-4 rounded-xl font-bold text-center shadow-md transition-colors flex items-center justify-center gap-2 text-sm"
                  >
                    <AlertTriangle className="w-4 h-4 animate-pulse" /> Contact Support Immediately
                  </a>

                  <div className="text-center">
                    <button
                      onClick={() => handleResetTiffin(displayTiffin.tiffinId)}
                      className="text-[10px] text-[#8C8275] border border-[#E5E0D8] inline-block px-3 py-1.5 rounded-lg hover:bg-[#FAF7F2]"
                    >
                      🔄 Reset This Tiffin State (Developer Sandbox)
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </main>

        <footer className="w-full max-w-md text-center mt-8 text-[11px] text-[#8C8275] flex flex-col gap-2">
          <p>© {new Date().getFullYear()} Tiffin Trace Verification Desk.</p>
          <div className="flex justify-center gap-4">
            <button onClick={() => setUrlTiffinId(null)} className="underline hover:text-[#2C1810]">
              Open Operations Station
            </button>
            <span>•</span>
            <a href="https://wa.me/918917873032" target="_blank" rel="noreferrer" className="underline hover:text-[#2C1810]">
              WhatsApp Direct
            </a>
          </div>
        </footer>

        {/* FLOATING WHATSAPP CHAT BUTTON */}
        <a
          id="whatsapp-floater"
          href="https://wa.me/918917873032?text=Hello%21%20I%20have%20an%20inquiry%20regarding%20my%20secure%20tiffin%20delivery."
          target="_blank"
          rel="noopener noreferrer"
          style={{ zIndex: 9999 }}
          className="fixed bottom-6 right-6 w-14 h-14 bg-[#25D366] hover:bg-[#20ba59] text-white rounded-full shadow-2xl flex items-center justify-center transition-transform hover:scale-110 duration-200"
          title="Instant Help via WhatsApp"
        >
          <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.72.937 3.659 1.432 5.628 1.433h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
          </svg>
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full border-2 border-white text-[10px] font-bold text-white flex items-center justify-center animate-pulse">
            1
          </span>
        </a>
      </div>
    );
  }

  // CORE PORTAL VIEW (For Operations, configuration and on-screen interactive testing simulation)
  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#4A3728] font-sans flex flex-col overflow-x-hidden">
      {/* Dynamic Header */}
      <nav className="px-6 md:px-12 py-5 flex justify-between items-center bg-white border-b border-[#E5E0D8] shrink-0 sticky top-0 z-50 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#7D8F69] rounded-xl flex items-center justify-center shadow-inner">
            <QrCode className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[#2C1810]">TiffinTrace Secure</h1>
            <p className="text-[10px] text-[#8C8275] uppercase tracking-wider font-bold">Paper-Tape Seal Auth Service</p>
          </div>
        </div>

        <div className="flex gap-4 items-center">
          <div className="hidden lg:flex gap-6 items-center text-xs font-semibold uppercase tracking-wider text-[#8C8275] mr-4">
            <span className="hover:text-[#2C1810] cursor-pointer" onClick={() => logAction('Navigated of Overview')}>Operational Board</span>
            <span>•</span>
            <span className="text-[#7D8F69] border-b-2 border-[#7D8F69] pb-1">Real-Time Core Station</span>
          </div>

          <button
            onClick={fetchTiffins}
            className="p-2 border border-[#E5E0D8] hover:bg-[#FAF7F2] rounded-lg text-[#8C8275] hover:text-[#4A3728] transition-colors"
            title="Force List Sync"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          <button
            id="btn-add-tiffin-modal"
            onClick={() => setShowAddForm(!showAddForm)}
            className="px-4 py-2 bg-[#7D8F69] hover:bg-[#6A7B58] text-white text-xs font-bold uppercase rounded-lg shadow-sm tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <PlusCircle className="w-4 h-4" /> Add Courier Record
          </button>
        </div>
      </nav>

      <div className="flex-1 w-full max-w-7xl mx-auto px-4 md:px-8 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COMPONENT/BENTO COLUMN - OPERATIONS PANEL & SHEET VIEW */}
        <div className="lg:col-span-8 space-y-6">
          
          {/* Real-time Google Sheets Integration block */}
          <section className="p-6 md:p-8 bg-white rounded-3xl border border-[#E5E0D8] shadow-sm relative overflow-hidden">
            <div className="absolute right-0 top-0 w-24 h-24 bg-[#7D8F69]/5 rounded-bl-full flex items-center justify-center text-[#7D8F69] opacity-35">
              <Sparkles className="w-12 h-12 rotate-12" />
            </div>

            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 bg-[#F4F9F1] rounded-xl text-[#7D8F69]">
                <FileSpreadsheet className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-[#2C1810]">Google Sheets Real-time Integrator</h2>
                <p className="text-xs text-[#8C8275]">Binds your physical dispatching verification sequence directly into online registers.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-[#FAF7F2] p-4 rounded-xl border border-[#E5E0D8] space-y-1">
                <span className="text-[10px] text-[#8C8275] uppercase font-bold tracking-brand">Synchronizer Status</span>
                <p className="text-sm font-bold flex items-center gap-1.5 text-[#2C1810]">
                  {sheetsConfig.useMock ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-[#BC6C25] animate-pulse"></span>
                      Local Storage Mock
                    </>
                  ) : (
                    <>
                      <span className="w-2 h-2 rounded-full bg-[#7D8F69] animate-pulse"></span>
                      Google Sheets Live
                    </>
                  )}
                </p>
              </div>
              <div className="bg-[#FAF7F2] p-4 rounded-xl border border-[#E5E0D8] space-y-1">
                <span className="text-[10px] text-[#8C8275] uppercase font-bold tracking-brand">Spreadsheet Connection</span>
                <p className="text-sm font-semibold truncate font-mono text-[#4A3728]">
                  {sheetsConfig.sheetsId ? sheetsConfig.sheetsId : 'Unlinked Workspace ID'}
                </p>
              </div>
              <div className="bg-[#FAF7F2] p-4 rounded-xl border border-[#E5E0D8] space-y-1">
                <span className="text-[10px] text-[#8C8275] uppercase font-bold tracking-brand">Verification Code Linkage</span>
                <p className="text-sm font-semibold text-[#4A3728]">
                  Mobile OTP Direct Sync
                </p>
              </div>
            </div>

            <div className="bg-[#FAF7F2] border border-[#E5E0D8] rounded-xl p-4 flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="text-left space-y-0.5 animate-fade-in">
                <p className="text-xs font-bold text-[#4A3728]">Google Sheets Core Connection Workspace</p>
                <p className="text-[11px] text-[#8C8275]">
                  Enables auto-populating order profiles and updating thali verification state in real time via official Google APIs.
                </p>
                {!sheetsConfig.useMock && sheetsConfig.sheetsId && (
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      onClick={pullFromGoogleSheet}
                      className="text-[10px] font-bold text-[#7D8F69] bg-[#7D8F69]/10 hover:bg-[#7D8F69]/25 px-2 py-1 rounded transition-colors border border-[#7D8F69]/15 cursor-pointer"
                    >
                      📥 Pull from Sheet
                    </button>
                    <button
                      type="button"
                      onClick={pushToGoogleSheet}
                      className="text-[10px] font-bold text-[#BC6C25] bg-[#BC6C25]/10 hover:bg-[#BC6C25]/25 px-2 py-1 rounded transition-colors border border-[#BC6C25]/15 cursor-pointer"
                    >
                      📤 Push to Sheet
                    </button>
                  </div>
                )}
              </div>

              <div className="flex gap-2 w-full md:w-auto shrink-0 justify-end items-center flex-wrap">
                {sheetsConfig.useMock ? (
                  <button
                    type="button"
                    onClick={handleConnectGoogleDrive}
                    className="w-full md:w-auto px-4 py-2 bg-[#7D8F69] hover:bg-[#6A7B58] text-white rounded-lg text-xs font-bold uppercase transition-colors tracking-wider cursor-pointer"
                  >
                    🔌 Link Google Account
                  </button>
                ) : (
                  <>
                    {sheetsConfig.sheetsId && (
                      <a
                        href={`https://docs.google.com/spreadsheets/d/${sheetsConfig.sheetsId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 bg-green-50 hover:bg-green-100 border border-[#7D8F69]/30 text-[#7D8F69] rounded-lg text-xs font-bold uppercase transition-all flex items-center gap-1 shrink-0"
                      >
                        <ExternalLink className="w-3.5 h-3.5" /> Open sheet
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={handleDisconnectGoogleDrive}
                      className="px-3 py-1.5 text-xs font-semibold text-[#BC6C25] hover:bg-[#BC6C25]/10 rounded-lg border border-[#BC6C25]/20 cursor-pointer shrink-0"
                    >
                      Disconnect
                    </button>
                    <span className="px-3 py-1.5 bg-[#F4F9F1] border border-[#D5E6CD] text-[#7D8F69] rounded-lg font-bold text-xs shrink-0">
                      ✓ Connected Setup
                    </span>
                  </>
                )}
              </div>
            </div>
          </section>

          {/* ADD COURIER RECORD INLINE DRAWER */}
          {showAddForm && (
            <form onSubmit={handleAddTiffinSubmit} className="p-6 bg-[#FAF7F2] border-2 border-dashed border-[#E5E0D8] rounded-2xl space-y-4 animate-fade-in relative">
              <button 
                type="button" 
                onClick={() => setShowAddForm(false)} 
                className="absolute top-4 right-4 text-[#8C8275] hover:text-[#2C1810]"
              >
                <X className="w-5 h-5" />
              </button>
              
              <h3 className="font-serif text-[#2C1810] text-lg font-bold">Deploy New Secure Tiffin Order</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                <div className="space-y-1">
                  <label className="block font-semibold">Tiffin ID (Required)</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. TIF-106"
                    value={newTiffinId}
                    onChange={(e) => setNewTiffinId(e.target.value)}
                    className="w-full p-2.5 bg-white border border-[#E5E0D8] rounded-lg text-sm uppercase placeholder-[#C8C2B8]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block font-semibold">Customer Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Rahul Sen"
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    className="w-full p-2.5 bg-white border border-[#E5E0D8] rounded-lg text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block font-semibold">Verification Passcode OTP</label>
                  <input
                    type="text"
                    placeholder="Default: Auto 6-digit"
                    value={newOtp}
                    onChange={(e) => setNewOtp(e.target.value)}
                    className="w-full p-2.5 bg-white border border-[#E5E0D8] rounded-lg text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                <div className="space-y-1">
                  <label className="block font-semibold">Member ID</label>
                  <input
                    type="text"
                    placeholder="e.g. MEM-0077"
                    value={newMemberId}
                    onChange={(e) => setNewMemberId(e.target.value)}
                    className="w-full p-2.5 bg-white border border-[#E5E0D8] rounded-lg text-sm uppercase"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block font-semibold">Order ID</label>
                  <input
                    type="text"
                    placeholder="e.g. ORD-109"
                    value={newOrderId}
                    onChange={(e) => setNewOrderId(e.target.value)}
                    className="w-full p-2.5 bg-white border border-[#E5E0D8] rounded-lg text-sm uppercase"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block font-semibold">Mobile Number</label>
                  <input
                    type="text"
                    placeholder="98xxxxxx"
                    value={newMobile}
                    onChange={(e) => setNewMobile(e.target.value)}
                    className="w-full p-2.5 bg-white border border-[#E5E0D8] rounded-lg text-sm"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full bg-[#7D8F69] hover:bg-[#6A7B58] text-white py-2.5 font-bold rounded-lg text-xs uppercase"
              >
                Add Verification Row into Server
              </button>
            </form>
          )}

          {/* CENTRAL ROW DATABASE TABLE */}
          <section className="bg-white rounded-3xl border border-[#E5E0D8] shadow-sm overflow-hidden p-6 md:p-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="text-xl font-serif text-[#2C1810]">Operational Database Overview</h2>
                <p className="text-xs text-[#8C8275]">Active courier indices. Direct simulation click allows you to view the simulated scan endpoints.</p>
              </div>
              <div className="flex gap-2">
                <span className="px-3 py-1 bg-[#FAF7F2] border border-[#E5E0D8] rounded-lg text-xs font-semibold text-[#4A3728]">
                  Total Records: {tiffins.length}
                </span>
                <span className="px-3 py-1 bg-[#F4F9F1] border border-[#D5E6CD] rounded-lg text-xs font-semibold text-[#7D8F69]">
                  Dispatched: {tiffins.filter(t => t.status === 'Dispatched').length}
                </span>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-[#E5E0D8]">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="bg-[#FAF7F2] text-[#8C8275] border-b border-[#E5E0D8] text-[11px] uppercase font-bold tracking-wider">
                    <th className="p-4">Tiffin</th>
                    <th className="p-4">Subscriber</th>
                    <th className="p-4 text-center">Security Level status</th>
                    <th className="p-4 text-center">Registered OTP</th>
                    <th className="p-4 text-right">Action Simulated Scanners</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E0D8] text-xs">
                  {tiffins.map((tiffin) => (
                    <tr key={tiffin.tiffinId} className="hover:bg-[#FAF7F2]/50 transition-colors">
                      <td className="p-4">
                        <div className="font-mono font-bold text-[#2C1810] text-sm">{tiffin.tiffinId}</div>
                        <div className="text-[10px] text-[#8C8275]">{tiffin.orderId} • {tiffin.memberId}</div>
                      </td>
                      <td className="p-4">
                        <div className="font-semibold text-[#4A3728]">{tiffin.customerName}</div>
                        <div className="text-[10px] text-[#8C8275] font-mono">{tiffin.mobileNumber}</div>
                      </td>
                      <td className="p-4 text-center">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          tiffin.status === 'Pending' 
                            ? 'bg-amber-50 text-amber-700 border border-amber-200' 
                            : tiffin.status === 'Dispatched' 
                              ? 'bg-blue-50 text-blue-700 border border-blue-200'
                              : 'bg-green-50 text-green-700 border border-green-200'
                        }`}>
                          {tiffin.status}
                        </span>
                        <div className="text-[9px] text-[#8C8275] mt-1 font-mono">Scanned: {tiffin.scanCount}x</div>
                      </td>
                      <td className="p-4 text-center font-mono font-bold text-sm bg-[#FAF7F2]/40 text-[#2C1810]">
                        {tiffin.otp}
                      </td>
                      <td className="p-4 text-right space-y-1">
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => {
                              setSelectedSimTiffinId(tiffin.tiffinId);
                              setSimActiveTab('mobile');
                              // Pull latest scanned state
                              fetchActiveTiffin(tiffin.tiffinId, true);
                            }}
                            className="bg-[#7D8F69] hover:bg-[#6A7B58] text-white text-[10px] uppercase tracking-wider font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition-all"
                            title="Simulate lens barcode direct integration"
                          >
                            <Smartphone className="w-3 h-3" /> Simulate Scan
                          </button>
                          
                          <button
                            onClick={() => handleResetTiffin(tiffin.tiffinId)}
                            className="border border-[#E5E0D8] hover:bg-white text-[#8C8275] hover:text-[#2C1810] p-1.5 rounded-lg text-xs"
                            title="Reset Code Scans"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {tiffins.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-[#8C8275]">
                        No active secure tiffins discovered inside server databases. Click "Add Courier Record" above.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Simulated Live Google sheets spreadsheet view */}
            <div className="mt-8 pt-6 border-t border-[#E5E0D8]">
              <div className="flex items-center gap-2 mb-3">
                <FileSpreadsheet className="w-4 h-4 text-[#7D8F69]" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#4A3728]">Live Google Sheet Sync Log (Simulated)</h4>
              </div>
              <div className="bg-[#FAF7F2] border border-[#E5E0D8] rounded-xl p-4 font-mono text-[10px] text-[#8C8275] h-32 overflow-y-auto space-y-1.5">
                <div className="w-full flex justify-between border-b border-[#E5E0D8]/60 pb-1 font-bold">
                  <span>TIMESTAMP / ACTION</span>
                  <span>SPREADSHEET UPDATE RECORD STATUS</span>
                </div>
                {historyLogs.length > 0 ? (
                  historyLogs.map((log, index) => (
                    <div key={index} className="flex justify-between py-0.5">
                      <span className="text-[#8C8275]">{log.time}</span>
                      <span className={
                        log.type === 'success' ? 'text-green-600 font-semibold' :
                        log.type === 'warning' ? 'text-amber-600' :
                        log.type === 'error' ? 'text-red-600 font-bold' : 'text-[#4A3728]'
                      }>
                        {log.text}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-6">No spreadsheet telemetry logged. Scanning QR simulator or changing statuses drives automated live logging.</div>
                )}
              </div>
            </div>
          </section>

          {/* SYSTEM DESCRIPTION PROTOCOL INFO */}
          <section className="p-6 md:p-8 bg-[#F5F1EB]/50 border border-[#E5E0D8] rounded-3xl flex flex-col md:flex-row gap-6 items-start">
            <div className="p-3 bg-white rounded-2xl shadow-sm text-[#BC6C25] shrink-0">
              <Info className="w-6 h-6" />
            </div>
            <div className="space-y-2">
              <h3 className="font-serif text-lg text-[#2C1810] font-bold">Operational Rules for Tiffin Dispatch Auth</h3>
              <p className="text-xs text-[#8C8275] leading-relaxed">
                Our verification system protects deliveries using custom URLs. Tiffins contain pre-applied physical QR codes. 
                Google Lens scans instantly query the active server databases and coordinate statuses:
              </p>
              <ul className="text-xs space-y-1 text-[#4A3728] list-disc list-inside">
                <li><strong>Scan 1 (Kitchen Ops):</strong> Allows kitchen operators to trigger dispatched states (fully undoable).</li>
                <li><strong>Scan 2 (Customer Side):</strong> Displays locked details, requests OTP and forces double joint paper tape verification.</li>
                <li><strong>Scan 3+ (Tamper Alert):</strong> Instantly locks down access, displaying extreme double-scan alert and directs subscriber to help desk.</li>
              </ul>
            </div>
          </section>
        </div>

        {/* RIGHT BENTO COLUMN - MOBILE LENS SIMULATOR */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white rounded-[32px] border border-[#E5E0D8] shadow-sm overflow-hidden p-6 md:p-8 relative">
            
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-[#7D8F69]" />
                <h3 className="text-sm font-bold uppercase tracking-wider text-[#2C1810]">Lens Mobile Simulator</h3>
              </div>
              <span className="text-[10px] uppercase font-bold text-[#8C8275] bg-[#FAF7F2] px-2.5 py-1 rounded-full">
                Active: {selectedSimTiffinId}
              </span>
            </div>

            {/* Realistic mobile wrapper mockup with lens frame */}
            <div className="relative mx-auto max-w-[280px] aspect-[9/19] bg-[#1a1310] rounded-[48px] p-3.5 shadow-2xl border-4 border-[#4A3728] overflow-hidden flex flex-col">
              
              {/* Phone ear-speaker Notch */}
              <div className="absolute top-0 inset-x-0 h-6 flex justify-center z-50">
                <div className="w-24 h-4 bg-black rounded-b-xl flex items-center justify-center">
                  <span className="w-2 h-2 rounded-full bg-gray-900 border border-gray-800"></span>
                </div>
              </div>

              {/* Mobile main viewport */}
              <div className="flex-1 bg-[#FAF7F2] rounded-[36px] overflow-y-auto p-4 flex flex-col justify-between text-xs font-sans relative pt-6 scrollbar-none">
                
                {/* Simulated Lens Bar */}
                <div className="bg-white/90 backdrop-blur border-b border-[#E5E0D8] py-1.5 px-3 rounded-full flex justify-between items-center mb-3 text-[10px] font-bold tracking-widest text-[#8C8275]">
                  <span>🔍 GOOGLE LENS VIEW</span>
                  <span className="text-[#7D8F69] animate-pulse">● CONNECTED</span>
                </div>

                {/* Simulated screen components inside viewport */}
                {(() => {
                  const simTiffin = tiffins.find(t => t.tiffinId === selectedSimTiffinId);
                  
                  if (!simTiffin) {
                    return (
                      <div className="flex-1 flex flex-col justify-center items-center text-center p-4">
                        <HelpCircle className="w-8 h-8 text-[#8C8275] mb-2 animate-bounce" />
                        <p className="font-bold text-[#4A3728]">No Simulated ID Selected</p>
                        <p className="text-[10px] text-[#8C8275] mt-1">Select a simulated scan in the database list to launch.</p>
                      </div>
                    );
                  }

                  return (
                    <div className="flex-1 flex flex-col justify-between h-full">
                      
                      {/* Scan 1 View */}
                      {simTiffin.scanCount <= 1 && simTiffin.status === 'Pending' && (
                        <div className="flex-1 flex flex-col justify-center space-y-4">
                          <div className="text-center">
                            <span className="px-2 py-0.5 bg-[#F5F1EB] rounded-full text-[8px] font-bold text-[#8C8275] uppercase tracking-wider">
                              Dispatch Sequence 01
                            </span>
                            <h4 className="text-lg font-serif text-[#2C1810] mt-1">Ready for Courier</h4>
                          </div>

                          <div className="bg-white p-3 rounded-xl border border-[#E5E0D8] space-y-1.5 text-[10px]">
                            <p className="border-b pb-1">Container: <strong className="font-mono">{simTiffin.tiffinId}</strong></p>
                            <p className="border-b pb-1">Recipient: <span className="font-semibold">{simTiffin.customerName}</span></p>
                            <p>Verification OTP is saved inside Central Sync Sheets.</p>
                          </div>

                          <button
                            onClick={() => handleDispatch(simTiffin.tiffinId)}
                            className="w-full bg-[#7D8F69] text-white py-2.5 rounded-lg text-[10px] font-bold uppercase hover:bg-[#6A7B58] transition-colors"
                          >
                            Mark Dispatched
                          </button>
                        </div>
                      )}

                      {/* Scan 1 Success View (With Undo) */}
                      {simTiffin.scanCount === 1 && simTiffin.status === 'Dispatched' && (
                        <div className="flex-1 flex flex-col justify-center text-center space-y-4">
                          <div className="w-10 h-10 bg-[#F4F9F1] rounded-full flex items-center justify-center text-[#7D8F69] mx-auto shadow-sm">
                            <Check className="w-5 h-5 stroke-[3]" />
                          </div>
                          <div>
                            <h4 className="font-serif text-sm">Dispatched Out!</h4>
                            <p className="text-[9px] text-[#8C8275] mt-1">Courier is moving. Share OTP code with client.</p>
                          </div>

                          <button
                            onClick={() => handleUndoDispatch(simTiffin.tiffinId)}
                            className="text-[9px] text-[#BC6C25] font-bold flex items-center justify-center gap-0.5"
                          >
                            <Undo2 className="w-3 h-3" /> Undo Dispatch
                          </button>

                          <div className="pt-2 border-t border-[#E5E0D8]/60">
                            <p className="text-[8px] text-[#8C8275] leading-relaxed mb-2">Simulate scanning identical QR code second time:</p>
                            <button
                              onClick={() => fetchActiveTiffin(simTiffin.tiffinId, true)}
                              className="w-full bg-[#BC6C25] text-white py-1.5 rounded text-[8px] font-bold uppercase"
                            >
                              Scan Again (Sequence 02)
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Scan 2 View */}
                      {simTiffin.scanCount === 2 && simTiffin.status === 'Dispatched' && (
                        <div className="flex-1 flex flex-col justify-center space-y-3.5">
                          <div className="text-center">
                            <span className="px-2 py-0.5 bg-[#FBF2EB] rounded-full text-[8px] font-bold text-[#BC6C25] uppercase tracking-wider">
                              Handover Verification 02
                            </span>
                            <h4 className="text-base font-serif text-[#2C1810] mt-1">Verify Box Seal</h4>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-[9px]">
                            <div className="bg-white p-1.5 rounded-lg border text-center">
                              <p className="text-[#8C8275]">Subscriber</p>
                              <strong className="font-mono text-[9px] block text-[#2C1810] truncate">{simTiffin.memberId}</strong>
                            </div>
                            <div className="bg-white p-1.5 rounded-lg border text-center">
                              <p className="text-[#8C8275]">Order ID</p>
                              <strong className="font-mono text-[9px] block text-[#2C1810] truncate">{simTiffin.orderId}</strong>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <div>
                              <label className="text-[9px] uppercase font-bold text-[#8C8275]">Verification OTP</label>
                              <input
                                type="text"
                                maxLength={6}
                                value={enteredOtp}
                                onChange={(e) => setEnteredOtp(e.target.value.replace(/\D/g, ''))}
                                placeholder="• • • • • •"
                                className="w-full text-center py-2 bg-white border border-[#E5E0D8] rounded-lg tracking-[0.4em] text-sm text-[#2C1810] font-bold"
                              />
                              <p className="text-[8px] text-center text-[#BC6C25] mt-1 bg-[#FBF2EB] rounded py-0.5">
                                Required Code: <strong>{simTiffin.otp}</strong>
                              </p>
                            </div>

                            <label className="flex items-start gap-2 p-2 bg-white rounded-lg border border-[#E5E0D8] cursor-pointer text-[9px]">
                              <input
                                type="checkbox"
                                checked={sealConfirmed}
                                onChange={(e) => setSealConfirmed(e.target.checked)}
                                className="mt-0.5 text-[#7D8F69] border-[#E5E0D8]"
                              />
                              <span>
                                Confirm <strong>single joint paper tape seal</strong> is intact & undamaged.
                              </span>
                            </label>

                            <button
                              onClick={() => handleMarkReceived(simTiffin.tiffinId)}
                              className="w-full bg-[#7D8F69] text-white py-2 rounded-lg text-[9px] font-bold uppercase hover:bg-[#6A7B58] transition-colors"
                            >
                              Mark Received
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Scan 2 Success Block */}
                      {simTiffin.status === 'Received' && simTiffin.scanCount <= 2 && (
                        <div className="flex-1 flex flex-col justify-center text-center space-y-4">
                          <div className="w-10 h-10 bg-[#F4F9F1] text-[#7D8F69] rounded-full flex items-center justify-center mx-auto shadow-sm">
                            <Check className="w-5 h-5 stroke-[3]" />
                          </div>
                          <div>
                            <h4 className="font-serif text-sm">Delivery Fulfill Verified</h4>
                            <p className="text-[9px] text-[#8C8275] leading-relaxed mt-1">
                              Status and seal integrity record synced securely to Google Sheets spreadsheet.
                            </p>
                          </div>

                          <div className="bg-white p-2.5 rounded-lg border border-[#E5E0D8] text-[9.5px] text-left">
                            <p className="border-b pb-1">Container: <strong className="font-mono">{simTiffin.tiffinId}</strong></p>
                            <p>Time Fulfill: {simTiffin.receivedAt ? new Date(simTiffin.receivedAt).toLocaleTimeString() : 'Just now'}</p>
                          </div>

                          <button
                            onClick={() => handleResetTiffin(simTiffin.tiffinId)}
                            className="text-[9px] text-[#8C8275] border border-[#E5E0D8] py-1 rounded-md"
                          >
                            🔄 Clear (Scan Sequence 0)
                          </button>
                        </div>
                      )}

                      {/* Scan 3+ Warning Red Warning Alarm */}
                      {simTiffin.scanCount > 2 && (
                        <div className="flex-1 flex flex-col justify-center space-y-3.5 text-center">
                          <div className="w-10 h-10 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto animate-pulse">
                            <AlertTriangle className="w-5 h-5" />
                          </div>
                          <div>
                            <h4 className="text-red-700 font-bold uppercase text-xs tracking-wider">⚠️ Duplicate Scan</h4>
                            <p className="text-[9px] text-red-700 mt-1 pb-2 border-b">
                              QR already scanned and marked for delivery, contact support before receiving/ Don't accept it.
                            </p>
                          </div>

                          <div className="p-2 bg-white rounded border border-red-100 text-[8.5pt] text-left leading-relaxed text-[#2C1810]">
                            <p className="text-[8px] text-[#8C8275] font-bold uppercase border-b pb-0.5 mb-1">Audit telemetry</p>
                            <p><strong>ID:</strong> {simTiffin.tiffinId}</p>
                            <p><strong>Scan Frequency:</strong> {simTiffin.scanCount} loads</p>
                            <p><strong>System State:</strong> Received</p>
                          </div>

                          <a
                            href="https://wa.me/918917873032?text=Emergency%21%20Tiffin%20container%20scanned%20more%20than%20twice%20and%20warned%20as%20tampered.%20Tiffin%20ID%3A%20"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="bg-[#E11D48] text-white text-[9px] py-2 rounded-lg font-bold uppercase transition-colors"
                          >
                            Emergency Help
                          </a>

                          <button
                            onClick={() => handleResetTiffin(simTiffin.tiffinId)}
                            className="text-[9px] text-[#8C8275] hover:underline"
                          >
                            Reset Tracing
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Mobile simulated UI footer */}
                <div className="pt-3 border-t border-[#E5E0D8] text-center text-[7.5px] text-[#8C8275] flex justify-between items-center bg-white/40 -mx-4 -mb-4 px-4 py-2">
                  <span>© Tiffin Trace Mobile</span>
                  <span>SSL SECURED</span>
                </div>
              </div>
            </div>

            <div className="text-center mt-5 text-xs text-[#8C8275] leading-relaxed">
              Scan a table row's <strong>"Simulate Scan"</strong> button on the left to inspect its active workflow inside this live Lens simulator pane.
            </div>
          </div>

          {/* REAL PRINTABLE HIGH-RESOLUTION QR CODES */}
          <div className="bg-white rounded-[32px] border border-[#E5E0D8] shadow-sm p-6 space-y-4">
            <h3 className="font-serif text-[#2C1810] text-sm font-bold flex items-center gap-1.5 uppercase tracking-wide">
              <QrCode className="w-5 h-5 text-[#7D8F69]" /> Physical QR Sticker Generator
            </h3>
            <p className="text-xs text-[#8C8275] leading-relaxed">
              These are compliant, print-ready, high-resolution QR codes mapped to the live web routes. Perfect to test on real devices via your smartphone's camera or Google Lens.
            </p>

            <div className="bg-[#FAF7F2] p-4 rounded-2xl border border-[#E5E0D8] flex flex-col items-center text-center space-y-3">
              <span className="text-[10px] text-[#8C8275] uppercase font-bold">Generated QR Code</span>
              
              {qrCache[selectedSimTiffinId] ? (
                <div className="bg-white p-3 rounded-xl border border-[#E5E0D8] shadow-sm">
                  <img src={qrCache[selectedSimTiffinId]} alt="Verification QR Code" className="w-32 h-32" />
                  <p className="font-mono text-xs text-[#2C1810] font-bold mt-2 bg-[#FAF7F2] px-2 py-0.5 rounded-full inline-block">
                    {selectedSimTiffinId}
                  </p>
                </div>
              ) : (
                <div className="w-32 h-32 bg-white rounded-xl border border-dashed border-[#E5E0D8] flex items-center justify-center text-xs text-[#8C8275]">
                  Generating QR...
                </div>
              )}

              {/* Mobile Scan Help & Base URL Override */}
              <div className="w-full text-left space-y-1.5 pt-2 border-t border-[#E5E0D8]/60 mt-1">
                <label className="text-[10px] font-bold text-[#4A3728] uppercase flex justify-between items-center flex-wrap gap-1">
                  <span>🌐 QR Target Base URL:</span>
                  {qrBaseUrl.includes('localhost') && (
                    <span className="text-red-600 font-bold lowercase text-[9px] animate-pulse">
                      ⚠️ localhost cannot be scanned from smartphone
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  value={qrBaseUrl}
                  onChange={(e) => {
                    const val = e.target.value;
                    setQrBaseUrl(val);
                    localStorage.setItem('tiffintrace_qr_base_url', val);
                  }}
                  placeholder="https://your-public-app-url..."
                  className="w-full px-2 py-1 text-[11px] bg-white border border-[#E5E0D8] rounded font-mono text-[#2C1810] focus:ring-1 focus:ring-[#7D8F69] outline-none"
                />
                <div className="flex gap-1 flex-wrap pt-0.5">
                  <button
                    type="button"
                    className="text-[9px] bg-[#BC6C25]/10 hover:bg-[#BC6C25]/20 text-[#9E5314] px-1.5 py-0.5 rounded font-bold transition-all cursor-pointer border border-[#BC6C25]/20 animate-pulse"
                    onClick={() => {
                      const sharedUrl = 'https://ais-pre-rpu5y7afywupdlaaz5emii-51302743345.asia-southeast1.run.app';
                      setQrBaseUrl(sharedUrl);
                      localStorage.setItem('tiffintrace_qr_base_url', sharedUrl);
                      logAction('Target QR Base URL updated to Shared Public Release URL! Mobile scans will now load flawlessly.', 'success');
                    }}
                  >
                    ✨ Set Shared Public URL (For Phones)
                  </button>
                  <button
                    type="button"
                    className="text-[9px] bg-[#7D8F69]/10 hover:bg-[#7D8F69]/20 text-[#6A7B58] px-1.5 py-0.5 rounded font-semibold transition-colors cursor-pointer border border-[#7D8F69]/20"
                    onClick={() => {
                      const devUrl = 'https://ais-dev-rpu5y7afywupdlaaz5emii-51302743345.asia-southeast1.run.app';
                      setQrBaseUrl(devUrl);
                      localStorage.setItem('tiffintrace_qr_base_url', devUrl);
                      logAction('Target QR Base URL updated to Public Dev Environment URL!', 'success');
                    }}
                  >
                    🛠️ Set Sandbox Dev URL
                  </button>
                  <button
                    type="button"
                    className="text-[9px] bg-gray-100 hover:bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded font-semibold transition-colors cursor-pointer border border-gray-300"
                    onClick={() => {
                      const localUrl = window.location.origin;
                      setQrBaseUrl(localUrl);
                      localStorage.setItem('tiffintrace_qr_base_url', localUrl);
                      logAction('Target QR Base URL reset to default.', 'info');
                    }}
                  >
                    Reset
                  </button>
                </div>
                <p className="text-[9px] text-[#8C8275] leading-tight">
                  💡 <strong>Why the scanned error happened:</strong> The Dev URL (<code>ais-dev-...</code>) is protected by AI Studio and requires your developer session cookies. Your smartphone browser doesn't have these, causing an error. 
                  Clicking <strong className="text-[#9E5314]">✨ Set Shared Public URL</strong> generates QR codes pointing to the public release build (<code>ais-pre-...</code>), which works 100% on any device globally without logging in!
                </p>
              </div>

              <div className="flex gap-2 w-full pt-1">
                <a
                  href={`${qrBaseUrl.replace(/\/$/, '')}?tiffinId=${selectedSimTiffinId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 text-center bg-white border border-[#E5E0D8] hover:bg-[#F5F1EB] text-[#4A3728] py-2 rounded-lg text-[10px] font-bold uppercase transition-all tracking-wider flex items-center justify-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" /> Standalone View
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* FOOTER BAR */}
      <footer className="px-6 md:px-12 py-5 bg-[#2C1810] text-[#F5F1EB] text-xs uppercase tracking-[0.2em] flex flex-col md:flex-row justify-between items-center gap-3 shrink-0">
        <span className="text-[10px] text-center md:text-left">
          🔐 Tiffin Trace Security Protocol Integration Desk • Verified Realtime Sync API
        </span>
        <div className="flex gap-6 text-[10px]">
          <a href="https://wa.me/918917873032" target="_blank" rel="noreferrer" className="hover:text-white transition-colors">
            Contact Support (WhatsApp +918917873032)
          </a>
        </div>
      </footer>

      {/* FLOATING WHATSAPP CHAT BUTTON */}
      <a
        id="whatsapp-floater"
        href="https://wa.me/918917873032?text=Hello%21%20I%20have%20an%20inquiry%20regarding%20my%20secure%20tiffin%20delivery."
        target="_blank"
        rel="noopener noreferrer"
        style={{ zIndex: 9999 }}
        className="fixed bottom-6 right-6 w-14 h-14 bg-[#25D366] hover:bg-[#20ba59] text-white rounded-full shadow-2xl flex items-center justify-center transition-transform hover:scale-110 duration-200"
        title="Instant Help via WhatsApp"
      >
        <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.72.937 3.659 1.432 5.628 1.433h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
        </svg>
        <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full border-2 border-white text-[10px] font-bold text-white flex items-center justify-center animate-pulse">
          1
        </span>
      </a>
    </div>
  );
}
