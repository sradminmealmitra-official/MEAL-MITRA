export interface TiffinOrder {
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

export interface SheetsConfig {
  useMock: boolean;
  sheetsId: string;
  appsScriptUrl: string;
}

export interface AppState {
  orders: TiffinOrder[];
  config: SheetsConfig;
  activeTiffinId: string | null;
  scannedCountInSession: number; // to help client handle scans mock-wise
}
