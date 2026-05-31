import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';

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

const DB_FILE = path.join(process.cwd(), 'db.json');

// Initialize with custom mockup data if file doesn't exist
function initDb() {
  if (fs.existsSync(DB_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')) as TiffinOrder[];
    } catch (e) {
      console.error('Error reading DB, re-initializing', e);
    }
  }

  const defaultData: TiffinOrder[] = [
    {
      tiffinId: 'TIF-101',
      orderId: 'ORD-5521',
      memberId: 'MEM-9901',
      customerName: 'Aarav Sharma',
      mobileNumber: '9876543210',
      otp: '482910',
      status: 'Pending',
      scanCount: 0,
    },
    {
      tiffinId: 'TIF-102',
      orderId: 'ORD-5522',
      memberId: 'MEM-9902',
      customerName: 'Priya Patel',
      mobileNumber: '8765432109',
      otp: '739415',
      status: 'Dispatched',
      scanCount: 1,
      dispatchedAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
      lastScannedAt: new Date(Date.now() - 3600000).toISOString(),
    },
    {
      tiffinId: 'TIF-103',
      orderId: 'ORD-5523',
      memberId: 'MEM-9903',
      customerName: 'Rohan Verma',
      mobileNumber: '7654321098',
      otp: '109382',
      status: 'Received',
      scanCount: 2,
      dispatchedAt: new Date(Date.now() - 7200000).toISOString(),
      receivedAt: new Date(Date.now() - 1800000).toISOString(),
      lastScannedAt: new Date(Date.now() - 1800000).toISOString(),
    },
    {
      tiffinId: 'TIF-104',
      orderId: 'ORD-5524',
      memberId: 'MEM-9904',
      customerName: 'Ananya Iyer',
      mobileNumber: '8917873032', // Matches prompt support, nice touch
      otp: '556112',
      status: 'Pending',
      scanCount: 0,
    },
    {
      tiffinId: 'TIF-105',
      orderId: 'ORD-5525',
      memberId: 'MEM-9905',
      customerName: 'Vikram Singh',
      mobileNumber: '9123456789',
      otp: '918420',
      status: 'Pending',
      scanCount: 0,
    }
  ];

  fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2), 'utf-8');
  return defaultData;
}

let tiffins = initDb();

function saveDb() {
  fs.writeFileSync(DB_FILE, JSON.stringify(tiffins, null, 2), 'utf-8');
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // API to get all tiffins
  app.get('/api/tiffins', (req, res) => {
    res.json(tiffins);
  });

  // API to set custom spreadsheet configuration
  const CONFIG_FILE = path.join(process.cwd(), 'sheets-config.json');
  app.get('/api/sheets-config', (req, res) => {
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        return res.json(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')));
      } catch (e) {}
    }
    res.json({ useMock: true, sheetsId: '', appsScriptUrl: '' });
  });

  app.post('/api/sheets-config', (req, res) => {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(req.body, null, 2), 'utf-8');
    res.json({ success: true, config: req.body });
  });

  // API to fetch specific tiffin & handle scanning increments
  app.get('/api/tiffins/:id', (req, res) => {
    const { id } = req.params;
    const isScanAction = req.query.scan === 'true';

    let tiffin = tiffins.find(t => t.tiffinId.toUpperCase() === id.toUpperCase());

    if (!tiffin) {
      // Create on demand if someone scans a new QR code to make the demo robust!
      tiffin = {
        tiffinId: id.toUpperCase(),
        orderId: `ORD-${Math.floor(1000 + Math.random() * 9000)}`,
        memberId: `MEM-${Math.floor(1000 + Math.random() * 9000)}`,
        customerName: 'Walk-in Customer / Guest',
        mobileNumber: '9900990099',
        otp: String(Math.floor(100000 + Math.random() * 900000)),
        status: 'Pending',
        scanCount: 0,
      };
      tiffins.push(tiffin);
      saveDb();
    }

    if (isScanAction) {
      tiffin.scanCount += 1;
      tiffin.lastScannedAt = new Date().toISOString();
      saveDb();
    }

    res.json(tiffin);
  });

  // API to create a custom tiffin order
  app.post('/api/tiffins', (req, res) => {
    const { tiffinId, orderId, memberId, customerName, mobileNumber, otp } = req.body;
    
    if (!tiffinId) {
      return res.status(400).json({ error: 'tiffinId is required' });
    }

    const tId = tiffinId.toUpperCase();
    const existingIndex = tiffins.findIndex(t => t.tiffinId.toUpperCase() === tId);

    const newTiffin: TiffinOrder = {
      tiffinId: tId,
      orderId: orderId || `ORD-${Math.floor(1000 + Math.random() * 9000)}`,
      memberId: memberId || `MEM-${Math.floor(1000 + Math.random() * 9000)}`,
      customerName: customerName || 'Valued Subscriber',
      mobileNumber: mobileNumber || '9876543210',
      otp: otp || String(Math.floor(100000 + Math.random() * 900000)),
      status: 'Pending',
      scanCount: 0,
    };

    if (existingIndex >= 0) {
      tiffins[existingIndex] = { ...tiffins[existingIndex], ...req.body, tiffinId: tId };
    } else {
      tiffins.push(newTiffin);
    }

    saveDb();
    res.json({ success: true, tiffin: existingIndex >= 0 ? tiffins[existingIndex] : newTiffin });
  });

  // REST api to dispatch tiffin (can be undone)
  app.post('/api/tiffins/:id/dispatch', (req, res) => {
    const { id } = req.params;
    const tiffin = tiffins.find(t => t.tiffinId.toUpperCase() === id.toUpperCase());
    if (!tiffin) {
      return res.status(404).json({ error: 'Tiffin not found' });
    }

    tiffin.status = 'Dispatched';
    tiffin.dispatchedAt = new Date().toISOString();
    // Ensure scan count is at least 1 when dispatched
    if (tiffin.scanCount === 0) {
      tiffin.scanCount = 1;
    }
    saveDb();
    res.json(tiffin);
  });

  // REST API to undo dispatch
  app.post('/api/tiffins/:id/undispatch', (req, res) => {
    const { id } = req.params;
    const tiffin = tiffins.find(t => t.tiffinId.toUpperCase() === id.toUpperCase());
    if (!tiffin) {
      return res.status(404).json({ error: 'Tiffin not found' });
    }

    tiffin.status = 'Pending';
    tiffin.dispatchedAt = undefined;
    tiffin.scanCount = 0; // Rewinds scan count back to 0 so kitchen screen can load
    saveDb();
    res.json(tiffin);
  });

  // REST API to receive a tiffin (verified OTP and seal checking)
  app.post('/api/tiffins/:id/receive', (req, res) => {
    const { id } = req.params;
    const { otp, confirmSeal } = req.body;

    const tiffin = tiffins.find(t => t.tiffinId.toUpperCase() === id.toUpperCase());
    if (!tiffin) {
      return res.status(404).json({ error: 'Tiffin not found' });
    }

    if (!confirmSeal) {
      return res.status(400).json({ error: 'Please confirm that the single joint paper tape seal is intact.' });
    }

    if (tiffin.otp !== otp) {
      return res.status(400).json({ error: 'Incorrect verification OTP. Please verify codes or check Google Sheets.' });
    }

    tiffin.status = 'Received';
    tiffin.receivedAt = new Date().toISOString();
    if (tiffin.scanCount < 2) {
      tiffin.scanCount = 2; // Increments to 2
    }
    saveDb();
    res.json({ success: true, tiffin });
  });

  // REST API to support manual status sync from external script/overwrites
  app.post('/api/tiffins/:id/sync', (req, res) => {
    const { id } = req.params;
    const { status, scanCount } = req.body;
    
    const tiffin = tiffins.find(t => t.tiffinId.toUpperCase() === id.toUpperCase());
    if (tiffin) {
      if (status) tiffin.status = status;
      if (typeof scanCount === 'number') tiffin.scanCount = scanCount;
      saveDb();
      return res.json({ success: true, tiffin });
    }
    res.status(404).json({ error: 'Tiffin not found' });
  });

  // REST api to reset the entire database to simulate fresh scans
  app.post('/api/tiffins/:id/reset', (req, res) => {
    const { id } = req.params;
    const tiffin = tiffins.find(t => t.tiffinId.toUpperCase() === id.toUpperCase());
    if (!tiffin) {
      return res.status(404).json({ error: 'Tiffin not found' });
    }

    tiffin.status = 'Pending';
    tiffin.scanCount = 0;
    tiffin.dispatchedAt = undefined;
    tiffin.receivedAt = undefined;
    tiffin.lastScannedAt = undefined;
    saveDb();
    res.json(tiffin);
  });

  // Support both process.env.NODE_ENV and detection of built assets to handle container differences smoothly
  const distPath = path.join(process.cwd(), 'dist');
  const indexExists = fs.existsSync(path.join(distPath, 'index.html'));
  const isProduction = process.env.NODE_ENV === 'production' || indexExists;

  console.log(`[Server] Detected mode: ${isProduction ? 'PROD (static assets)' : 'DEV (Vite middleware)'}, NODE_ENV=${process.env.NODE_ENV}, indexExists=${indexExists}`);

  if (isProduction) {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const port = 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${port}`);
  });
}

startServer();
