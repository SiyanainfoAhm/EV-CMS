export const mockRfidCards = [
  { id: "rfid-001", uid: "RFID-DFCCIL-001", status: "active", boundUser: "Rajesh Kumar", boundUserId: "user-001", createdAt: "2026-01-15", lastUsed: "2026-06-01T08:15:00Z", totalSessions: 47 },
  { id: "rfid-002", uid: "RFID-DFCCIL-002", status: "active", boundUser: "Amit Sharma", boundUserId: "user-002", createdAt: "2026-02-01", lastUsed: "2026-06-01T09:30:00Z", totalSessions: 32 },
  { id: "rfid-003", uid: "RFID-DFCCIL-003", status: "active", boundUser: "Priya Singh", boundUserId: "user-003", createdAt: "2026-01-20", lastUsed: "2026-06-01T07:45:00Z", totalSessions: 28 },
  { id: "rfid-004", uid: "RFID-DFCCIL-004", status: "active", boundUser: "Sunil Verma", boundUserId: "user-004", createdAt: "2026-03-10", lastUsed: "2026-06-01T09:00:00Z", totalSessions: 19 },
  { id: "rfid-005", uid: "RFID-DFCCIL-005", status: "active", boundUser: "Vikram Patel", boundUserId: "user-005", createdAt: "2026-02-15", lastUsed: "2026-06-01T10:00:00Z", totalSessions: 35 },
  { id: "rfid-006", uid: "RFID-DFCCIL-006", status: "inactive", boundUser: null, boundUserId: null, createdAt: "2026-05-01", lastUsed: null, totalSessions: 0 },
  { id: "rfid-007", uid: "RFID-DFCCIL-007", status: "blocked", boundUser: "Kavita Reddy", boundUserId: "user-008", createdAt: "2026-03-20", lastUsed: "2026-05-15T14:30:00Z", totalSessions: 12 },
  { id: "rfid-008", uid: "RFID-DFCCIL-008", status: "active", boundUser: null, boundUserId: null, createdAt: "2026-05-15", lastUsed: null, totalSessions: 0 },
];

export const mockTariffs = [
  { id: "tariff-001", name: "DC Fast Charging - Standard", ratePerKwh: 15.00, sessionFee: 20.00, gstPercent: 18, appliesTo: "DC Fast", isActive: true, createdAt: "2026-01-01" },
  { id: "tariff-002", name: "AC Slow Charging - Standard", ratePerKwh: 8.00, sessionFee: 0, gstPercent: 18, appliesTo: "AC Slow", isActive: true, createdAt: "2026-01-01" },
  { id: "tariff-003", name: "DC Fast - Peak Hours", ratePerKwh: 18.00, sessionFee: 30.00, gstPercent: 18, appliesTo: "DC Fast", isActive: false, createdAt: "2026-03-15" },
];

export const mockPayments = [
  { id: "pay-001", sessionId: "sess-hist-001", userName: "Rajesh Kumar", amount: 597.00, gstAmount: 91.00, totalAmount: 688.00, status: "success", gateway: "SBIePay", gatewayTxnId: "SBI-20260531-001", reconciliation: "matched", createdAt: "2026-05-31T16:30:00Z" },
  { id: "pay-002", sessionId: "sess-hist-002", userName: "Amit Sharma", amount: 456.00, gstAmount: 69.50, totalAmount: 525.50, status: "success", gateway: "SBIePay", gatewayTxnId: "SBI-20260531-002", reconciliation: "matched", createdAt: "2026-05-31T14:15:00Z" },
  { id: "pay-003", sessionId: "sess-hist-003", userName: "Priya Singh", amount: 134.40, gstAmount: 20.50, totalAmount: 154.90, status: "success", gateway: "SBIePay", gatewayTxnId: "SBI-20260601-001", reconciliation: "matched", createdAt: "2026-06-01T10:32:00Z" },
  { id: "pay-004", sessionId: "sess-hist-004", userName: "Sunil Verma", amount: 0, gstAmount: 0, totalAmount: 0, status: "pending", gateway: null, gatewayTxnId: null, reconciliation: "unmatched", createdAt: "2026-06-01T10:32:00Z" },
  { id: "pay-005", sessionId: "sess-hist-005", userName: "Vikram Patel", amount: 219.00, gstAmount: 33.40, totalAmount: 252.40, status: "success", gateway: "SBIePay", gatewayTxnId: "SBI-20260530-005", reconciliation: "matched", createdAt: "2026-05-30T11:45:00Z" },
];