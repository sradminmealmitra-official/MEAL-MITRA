import { TiffinOrder } from '../types';

export interface GoogleSpreadsheetMetadata {
  id: string;
  title: string;
  url: string;
}

// Convert a TiffinOrder item into a Google Sheets row starting at column A (Tiffin ID)
export const tiffinToRowValues = (t: TiffinOrder): string[] => {
  return [
    t.tiffinId || '',
    t.orderId || '',
    t.memberId || '',
    t.customerName || '',
    t.mobileNumber || '',
    t.otp || '',
    t.status || 'Pending',
    String(t.scanCount ?? 0),
    t.lastScannedAt || '',
    t.dispatchedAt || '',
    t.receivedAt || '',
  ];
};

// Convert a Google Sheets string array row into a TiffinOrder item
export const rowValuesToTiffin = (row: any[]): TiffinOrder => {
  return {
    tiffinId: String(row[0] || '').trim(),
    orderId: String(row[1] || '').trim(),
    memberId: String(row[2] || '').trim(),
    customerName: String(row[3] || '').trim(),
    mobileNumber: String(row[4] || '').trim(),
    otp: String(row[5] || '').trim(),
    status: (String(row[6] || 'Pending').trim() as any),
    scanCount: parseInt(row[7]) || 0,
    lastScannedAt: row[8] ? String(row[8]).trim() : undefined,
    dispatchedAt: row[9] ? String(row[9]).trim() : undefined,
    receivedAt: row[10] ? String(row[10]).trim() : undefined,
  };
};

const HEADERS = [
  'Tiffin ID',
  'Order ID',
  'Member ID',
  'Customer Name',
  'Mobile Number',
  'OTP Passcode',
  'Status',
  'Scan Count',
  'Last Scanned At',
  'Dispatched At',
  'Received At',
];

/**
 * Creates a brand-new Spreadsheet in user's Google Drive and inserts the headers.
 */
export async function createNewSpreadsheet(accessToken: string, title = 'TiffinTrace Secure Delivery Register'): Promise<GoogleSpreadsheetMetadata> {
  const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        title,
      },
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || 'Failed to create spreadsheet');
  }

  const result = await response.json();
  const spreadsheetId = result.spreadsheetId;
  const sheetName = result.sheets?.[0]?.properties?.title || 'Sheet1';

  // Add the header row
  await writeHeaders(accessToken, spreadsheetId, sheetName);

  return {
    id: spreadsheetId,
    title,
    url: result.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
  };
}

/**
 * Writes the standard headers into row A1:K1 of the specified sheet.
 */
export async function writeHeaders(accessToken: string, spreadsheetId: string, sheetName = 'Sheet1') {
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}!A1:K1?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [HEADERS],
      }),
    }
  );

  if (!response.ok) {
    throw new Error('Failed to output sheet headers');
  }
}

/**
 * Reads all rows from the spreadsheet and parses them as TiffinOrders.
 */
export async function readOrdersFromSpreadsheet(accessToken: string, spreadsheetId: string, sheetName = 'Sheet1'): Promise<TiffinOrder[]> {
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}!A:K`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error('Failed to read spreadsheet contents. Make sure spreadsheet ID is correct and you have permission.');
  }

  const result = await response.json();
  const values = result.values || [];
  if (values.length <= 1) {
    return [];
  }

  // Row 0 is the headers; others are actual orders
  const tiffins: TiffinOrder[] = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (row && row[0]) {
      tiffins.push(rowValuesToTiffin(row));
    }
  }

  return tiffins;
}

/**
 * Syncs a single order to the Google Sheet. Checks if a row already exists
 * for the given tiffinId; if yes, updates that row. If not, appends a new row.
 */
export async function syncSingleOrderToSpreadsheet(
  accessToken: string,
  spreadsheetId: string,
  order: TiffinOrder,
  sheetName = 'Sheet1'
): Promise<void> {
  // 1. Retrieve all values to find the matching row index
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}!A:A`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error('Could not access spreadsheet to identify existing row.');
  }

  const result = await response.json();
  const colA = result.values || [];
  
  let targetRowIndex = -1;
  for (let i = 0; i < colA.length; i++) {
    if (colA[i] && String(colA[i][0]).trim().toUpperCase() === order.tiffinId.toUpperCase()) {
      targetRowIndex = i + 1; // 1-based index
      break;
    }
  }

  const rowValues = tiffinToRowValues(order);

  if (targetRowIndex !== -1) {
    // Row exists -> update it
    const updateResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}!A${targetRowIndex}:K${targetRowIndex}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: [rowValues],
        }),
      }
    );

    if (!updateResponse.ok) {
      throw new Error(`Failed to update row ${targetRowIndex} for ${order.tiffinId}`);
    }
  } else {
    // Row does not exist -> append it
    const appendResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}!A:K:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: [rowValues],
        }),
      }
    );

    if (!appendResponse.ok) {
      throw new Error(`Failed to append new row for ${order.tiffinId}`);
    }
  }
}

/**
 * Bulk writes/synchronizes all orders to the Google Sheet.
 * This overwrites the sheet from row A2 downwards.
 */
export async function bulkSyncOrdersToSpreadsheet(
  accessToken: string,
  spreadsheetId: string,
  orders: TiffinOrder[],
  sheetName = 'Sheet1'
): Promise<void> {
  // Clear any existing contents from row 2 down to 1000
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}!A2:K1000:clear`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (orders.length === 0) return;

  const values = orders.map(o => tiffinToRowValues(o));

  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}!A2?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values,
      }),
    }
  );

  if (!response.ok) {
    throw new Error('Failed to bulk sync orders to Google Sheet');
  }
}
