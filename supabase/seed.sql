-- EV CMS seed data (run after schema.sql + rls.sql + rfp_roles.sql in Supabase SQL Editor)
-- UUIDs must use hex digits only (0-9, a-f) — no letters like p, l, g in IDs.
-- Demo password for all users: dfccil123
-- Hash: SHA-256(password + salt) hex, salt = ev_salt_2026
--
-- RFP demo logins:
--   Mobile User (+ RFID): rajesh.kumar@dfccil.gov.in | suresh.nair@dfccil.gov.in
--   Web Super Admin:      anita.desai@dfccil.gov.in
--   Web Site Admin:       deepak.mehta@dfccil.gov.in
--   (DB role Operator/Viewer → app displays as User)

-- Optional reset (dev only):
-- TRUNCATE "EV_Payments", "EV_Receipts", "EV_MeterValues", "EV_ChargingSessions",
--   "EV_AuditLogs", "EV_RFIDCards", "EV_Tariffs", "EV_ChargerConnectors", "EV_Chargers",
--   "EV_UserSessions", "EV_Users", "EV_UserRoles" CASCADE;

INSERT INTO "EV_UserRoles" (code, name, description) VALUES
  ('SuperAdmin', 'Super Admin', 'RFP: full web admin access'),
  ('SiteAdmin', 'Site Admin', 'RFP: site-level web admin'),
  ('User', 'User', 'RFP: mobile charging app'),
  ('Operator', 'User (legacy)', 'Legacy DB value; maps to RFP User'),
  ('Viewer', 'User (legacy)', 'Legacy DB value; maps to RFP User')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description;

INSERT INTO "EV_Users" (id, email, password_hash, salt, full_name, role, status, department, last_login_at, created_at) VALUES
  ('a0000001-0000-4000-8000-000000000001', 'rajesh.kumar@dfccil.gov.in', '58d127a9573f925e3066ae3b9381d88c2be6656ee5f371c61be99d405d1a98c4', 'ev_salt_2026', 'Rajesh Kumar', 'Operator', 'active', 'Operations', '2026-06-01 07:30:00+00', '2026-01-15'),
  ('a0000001-0000-4000-8000-000000000002', 'amit.sharma@dfccil.gov.in', '58d127a9573f925e3066ae3b9381d88c2be6656ee5f371c61be99d405d1a98c4', 'ev_salt_2026', 'Amit Sharma', 'Operator', 'active', 'Operations', '2026-06-01 08:05:00+00', '2026-02-01'),
  ('a0000001-0000-4000-8000-000000000003', 'priya.singh@dfccil.gov.in', '58d127a9573f925e3066ae3b9381d88c2be6656ee5f371c61be99d405d1a98c4', 'ev_salt_2026', 'Priya Singh', 'Operator', 'active', 'Logistics', '2026-06-01 07:45:00+00', '2026-01-20'),
  ('a0000001-0000-4000-8000-000000000004', 'sunil.verma@dfccil.gov.in', '58d127a9573f925e3066ae3b9381d88c2be6656ee5f371c61be99d405d1a98c4', 'ev_salt_2026', 'Sunil Verma', 'Operator', 'active', 'Logistics', '2026-06-01 08:10:00+00', '2026-03-10'),
  ('a0000001-0000-4000-8000-000000000005', 'vikram.patel@dfccil.gov.in', '58d127a9573f925e3066ae3b9381d88c2be6656ee5f371c61be99d405d1a98c4', 'ev_salt_2026', 'Vikram Patel', 'Operator', 'active', 'Operations', '2026-06-01 08:30:00+00', '2026-02-15'),
  ('a0000001-0000-4000-8000-000000000006', 'anita.desai@dfccil.gov.in', '58d127a9573f925e3066ae3b9381d88c2be6656ee5f371c61be99d405d1a98c4', 'ev_salt_2026', 'Anita Desai', 'SuperAdmin', 'active', 'IT', '2026-06-01 08:00:00+00', '2025-12-01'),
  ('a0000001-0000-4000-8000-000000000007', 'manoj.tiwari@dfccil.gov.in', '58d127a9573f925e3066ae3b9381d88c2be6656ee5f371c61be99d405d1a98c4', 'ev_salt_2026', 'Manoj Tiwari', 'Viewer', 'active', 'Management', '2026-05-31 16:20:00+00', '2026-04-05'),
  ('a0000001-0000-4000-8000-000000000008', 'kavita.reddy@dfccil.gov.in', '58d127a9573f925e3066ae3b9381d88c2be6656ee5f371c61be99d405d1a98c4', 'ev_salt_2026', 'Kavita Reddy', 'Operator', 'inactive', 'Operations', '2026-05-16 14:00:00+00', '2026-03-20'),
  ('a0000001-0000-4000-8000-000000000009', 'deepak.mehta@dfccil.gov.in', '58d127a9573f925e3066ae3b9381d88c2be6656ee5f371c61be99d405d1a98c4', 'ev_salt_2026', 'Deepak Mehta', 'SiteAdmin', 'active', 'Operations', '2026-06-01 09:00:00+00', '2026-02-01'),
  ('a0000001-0000-4000-8000-00000000000a', 'suresh.nair@dfccil.gov.in', '58d127a9573f925e3066ae3b9381d88c2be6656ee5f371c61be99d405d1a98c4', 'ev_salt_2026', 'Suresh Nair', 'Operator', 'active', 'Logistics', '2026-06-01 08:45:00+00', '2026-03-01')
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  salt = EXCLUDED.salt,
  full_name = EXCLUDED.full_name,
  role = EXCLUDED.role,
  status = EXCLUDED.status,
  department = EXCLUDED.department,
  last_login_at = EXCLUDED.last_login_at;

INSERT INTO "EV_Chargers" (id, charge_point_id, name, manufacturer, model, serial_number, firmware_version, charger_type, max_power_kw, status, location, last_heartbeat_at) VALUES
  ('b0000001-0000-4000-8000-000000000001', 'MP-DC-001', 'MP Fast Charger Station 1', 'MyPower Experts', 'MP-30DC-DG', 'MP2024DC001', 'v2.4.1', 'DC Fast', 60, 'online', 'DFCCIL Yard, New Delhi', '2026-06-01 10:32:15+00'),
  ('b0000001-0000-4000-8000-000000000002', 'MP-DC-002', 'MP Fast Charger Station 2', 'MyPower Experts', 'MP-30DC-DG', 'MP2024DC002', 'v2.4.1', 'DC Fast', 60, 'online', 'DFCCIL Yard, New Delhi', '2026-06-01 10:31:48+00'),
  ('b0000001-0000-4000-8000-000000000003', 'MP-DC-003', 'MP Fast Charger Station 3', 'MyPower Experts', 'MP-30DC-DG', 'MP2024DC003', 'v2.4.1', 'DC Fast', 60, 'faulted', 'DFCCIL Warehouse, Mumbai', '2026-06-01 09:15:22+00'),
  ('b0000001-0000-4000-8000-000000000004', 'MP-DC-004', 'MP Fast Charger Station 4', 'MyPower Experts', 'MP-30DC-DG', 'MP2024DC004', 'v2.4.0', 'DC Fast', 60, 'online', 'DFCCIL Warehouse, Mumbai', '2026-06-01 10:32:00+00'),
  ('b0000001-0000-4000-8000-000000000005', 'MP-AC-001', 'MP Slow Charger Bay 1', 'MyPower Experts', 'MP-7.5AC-SG', 'MP2024AC001', 'v1.9.3', 'AC Slow', 7.5, 'online', 'DFCCIL Staff Parking, Delhi', '2026-06-01 10:31:55+00'),
  ('b0000001-0000-4000-8000-000000000006', 'MP-AC-002', 'MP Slow Charger Bay 2', 'MyPower Experts', 'MP-7.5AC-SG', 'MP2024AC002', 'v1.9.3', 'AC Slow', 7.5, 'online', 'DFCCIL Staff Parking, Delhi', '2026-06-01 10:30:10+00'),
  ('b0000001-0000-4000-8000-000000000007', 'MP-AC-003', 'MP Slow Charger Bay 3', 'MyPower Experts', 'MP-7.5AC-SG', 'MP2024AC003', 'v1.9.3', 'AC Slow', 7.5, 'offline', 'DFCCIL Staff Parking, Delhi', '2026-05-31 22:45:00+00'),
  ('b0000001-0000-4000-8000-000000000008', 'MP-AC-004', 'MP Slow Charger Bay 4', 'MyPower Experts', 'MP-7.5AC-SG', 'MP2024AC004', 'v1.9.3', 'AC Slow', 7.5, 'online', 'DFCCIL Depot, Chennai', '2026-06-01 10:29:40+00'),
  ('b0000001-0000-4000-8000-000000000009', 'MP-AC-005', 'MP Slow Charger Bay 5', 'MyPower Experts', 'MP-7.5AC-SG', 'MP2024AC005', 'v1.9.3', 'AC Slow', 7.5, 'online', 'DFCCIL Depot, Chennai', '2026-06-01 10:30:50+00'),
  ('b0000001-0000-4000-8000-000000000010', 'MP-AC-006', 'MP Slow Charger Bay 6', 'MyPower Experts', 'MP-7.5AC-SG', 'MP2024AC006', 'v1.9.3', 'AC Slow', 7.5, 'online', 'DFCCIL Depot, Chennai', '2026-06-01 10:31:20+00'),
  ('b0000001-0000-4000-8000-000000000011', 'TS-DC-001', 'TS Fast Charger Station 1', 'Tri Square', 'TS-30DC-DG', 'TS2024DC001', 'v3.1.0', 'DC Fast', 60, 'online', 'DFCCIL Yard, Kolkata', '2026-06-01 10:31:35+00'),
  ('b0000001-0000-4000-8000-000000000012', 'TS-AC-001', 'TS Slow Charger Bay 1', 'Tri Square', 'TS-7.4AC-SG', 'TS2024AC001', 'v2.0.5', 'AC Slow', 7.4, 'online', 'DFCCIL Depot, Kolkata', '2026-06-01 10:30:30+00')
ON CONFLICT (charge_point_id) DO UPDATE SET
  name = EXCLUDED.name, status = EXCLUDED.status, last_heartbeat_at = EXCLUDED.last_heartbeat_at;

INSERT INTO "EV_ChargerConnectors" (id, charger_id, connector_id, connector_type, max_power_kw, status) VALUES
  ('c0000001-0000-4000-8000-000000000001', 'b0000001-0000-4000-8000-000000000001', 1, 'CCS2', 30, 'Charging'),
  ('c0000001-0000-4000-8000-000000000002', 'b0000001-0000-4000-8000-000000000001', 2, 'CCS2', 30, 'Available'),
  ('c0000001-0000-4000-8000-000000000003', 'b0000001-0000-4000-8000-000000000002', 1, 'CCS2', 30, 'Available'),
  ('c0000001-0000-4000-8000-000000000004', 'b0000001-0000-4000-8000-000000000002', 2, 'CCS2', 30, 'Available'),
  ('c0000001-0000-4000-8000-000000000005', 'b0000001-0000-4000-8000-000000000003', 1, 'CCS2', 30, 'Faulted'),
  ('c0000001-0000-4000-8000-000000000006', 'b0000001-0000-4000-8000-000000000003', 2, 'CCS2', 30, 'Faulted'),
  ('c0000001-0000-4000-8000-000000000007', 'b0000001-0000-4000-8000-000000000004', 1, 'CCS2', 30, 'Charging'),
  ('c0000001-0000-4000-8000-000000000008', 'b0000001-0000-4000-8000-000000000004', 2, 'CCS2', 30, 'Available'),
  ('c0000001-0000-4000-8000-000000000009', 'b0000001-0000-4000-8000-000000000005', 1, 'Type2', 7.5, 'Charging'),
  ('c0000001-0000-4000-8000-000000000010', 'b0000001-0000-4000-8000-000000000006', 1, 'Type2', 7.5, 'Available'),
  ('c0000001-0000-4000-8000-000000000011', 'b0000001-0000-4000-8000-000000000007', 1, 'Type2', 7.5, 'Unavailable'),
  ('c0000001-0000-4000-8000-000000000012', 'b0000001-0000-4000-8000-000000000008', 1, 'Type2', 7.5, 'Available'),
  ('c0000001-0000-4000-8000-000000000013', 'b0000001-0000-4000-8000-000000000009', 1, 'Type2', 7.5, 'Charging'),
  ('c0000001-0000-4000-8000-000000000014', 'b0000001-0000-4000-8000-000000000010', 1, 'Type2', 7.5, 'Available'),
  ('c0000001-0000-4000-8000-000000000015', 'b0000001-0000-4000-8000-000000000011', 1, 'CCS2', 30, 'Available'),
  ('c0000001-0000-4000-8000-000000000016', 'b0000001-0000-4000-8000-000000000011', 2, 'CCS2', 30, 'Charging'),
  ('c0000001-0000-4000-8000-000000000017', 'b0000001-0000-4000-8000-000000000012', 1, 'Type2', 7.4, 'Available')
ON CONFLICT (charger_id, connector_id) DO UPDATE SET status = EXCLUDED.status;

INSERT INTO "EV_Tariffs" (id, name, rate_per_kwh, session_fee, gst_percent, applies_to, is_active, is_default, region, created_at) VALUES
  ('e0000001-0000-4000-8000-000000000010', 'Noida / UP — Standard (Temporary)', 7.70, 0, 18, 'All', true, true, 'Noida, Uttar Pradesh', '2026-06-01'),
  ('e0000001-0000-4000-8000-000000000001', 'DC Fast Charging - Standard', 15.00, 20.00, 18, 'DC Fast', true, false, NULL, '2026-01-01'),
  ('e0000001-0000-4000-8000-000000000002', 'AC Slow Charging - Standard', 8.00, 0, 18, 'AC Slow', true, false, NULL, '2026-01-01'),
  ('e0000001-0000-4000-8000-000000000003', 'DC Fast - Peak Hours', 18.00, 30.00, 18, 'DC Fast', false, false, NULL, '2026-03-15')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  rate_per_kwh = EXCLUDED.rate_per_kwh,
  session_fee = EXCLUDED.session_fee,
  gst_percent = EXCLUDED.gst_percent,
  applies_to = EXCLUDED.applies_to,
  is_active = EXCLUDED.is_active,
  is_default = EXCLUDED.is_default,
  region = EXCLUDED.region,
  updated_at = NOW();

INSERT INTO "EV_RFIDCards" (id, uid, user_id, status, last_used_at, total_sessions, created_at) VALUES
  ('d0000001-0000-4000-8000-000000000001', 'RFID-DFCCIL-001', 'a0000001-0000-4000-8000-000000000001', 'active', '2026-06-01 08:15:00+00', 47, '2026-01-15'),
  ('d0000001-0000-4000-8000-000000000002', 'RFID-DFCCIL-002', 'a0000001-0000-4000-8000-000000000002', 'active', '2026-06-01 09:30:00+00', 32, '2026-02-01'),
  ('d0000001-0000-4000-8000-000000000003', 'RFID-DFCCIL-003', 'a0000001-0000-4000-8000-000000000003', 'active', '2026-06-01 07:45:00+00', 28, '2026-01-20'),
  ('d0000001-0000-4000-8000-000000000004', 'RFID-DFCCIL-004', 'a0000001-0000-4000-8000-000000000004', 'active', '2026-06-01 09:00:00+00', 19, '2026-03-10'),
  ('d0000001-0000-4000-8000-000000000005', 'RFID-DFCCIL-005', 'a0000001-0000-4000-8000-000000000005', 'active', '2026-06-01 10:00:00+00', 35, '2026-02-15'),
  ('d0000001-0000-4000-8000-000000000006', 'RFID-DFCCIL-006', NULL, 'inactive', NULL, 0, '2026-05-01'),
  ('d0000001-0000-4000-8000-000000000007', 'RFID-DFCCIL-007', 'a0000001-0000-4000-8000-000000000008', 'blocked', '2026-05-15 14:30:00+00', 12, '2026-03-20'),
  ('d0000001-0000-4000-8000-000000000008', 'RFID-DFCCIL-008', NULL, 'active', NULL, 0, '2026-05-15'),
  ('d0000001-0000-4000-8000-000000000009', 'RFID-DFCCIL-009', 'a0000001-0000-4000-8000-000000000007', 'active', '2026-05-31 16:00:00+00', 8, '2026-04-05'),
  ('d0000001-0000-4000-8000-00000000000a', 'RFID-DFCCIL-010', 'a0000001-0000-4000-8000-00000000000a', 'active', NULL, 0, '2026-03-01')
ON CONFLICT (uid) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  status = EXCLUDED.status,
  last_used_at = EXCLUDED.last_used_at,
  total_sessions = EXCLUDED.total_sessions;

-- Active sessions
INSERT INTO "EV_ChargingSessions" (id, transaction_id, charger_id, connector_id, user_id, rfid_card_id, start_time, energy_kwh, current_power_kw, soc, status) VALUES
  ('f0000001-0000-4000-8000-000000000001', 1001, 'b0000001-0000-4000-8000-000000000001', 1, 'a0000001-0000-4000-8000-000000000001', 'd0000001-0000-4000-8000-000000000001', '2026-06-01 08:15:00+00', 38.5, 28.4, 78, 'active'),
  ('f0000001-0000-4000-8000-000000000002', 1002, 'b0000001-0000-4000-8000-000000000004', 1, 'a0000001-0000-4000-8000-000000000002', 'd0000001-0000-4000-8000-000000000002', '2026-06-01 09:30:00+00', 18.2, 26.1, 45, 'active'),
  ('f0000001-0000-4000-8000-000000000003', 1003, 'b0000001-0000-4000-8000-000000000005', 1, 'a0000001-0000-4000-8000-000000000003', 'd0000001-0000-4000-8000-000000000003', '2026-06-01 07:45:00+00', 16.8, 6.8, 92, 'active'),
  ('f0000001-0000-4000-8000-000000000004', 1004, 'b0000001-0000-4000-8000-000000000009', 1, 'a0000001-0000-4000-8000-000000000004', 'd0000001-0000-4000-8000-000000000004', '2026-06-01 09:00:00+00', 9.4, 6.5, 65, 'active'),
  ('f0000001-0000-4000-8000-000000000005', 1005, 'b0000001-0000-4000-8000-000000000011', 2, 'a0000001-0000-4000-8000-000000000005', 'd0000001-0000-4000-8000-000000000005', '2026-06-01 10:00:00+00', 14.6, 29.1, 55, 'active')
ON CONFLICT (id) DO NOTHING;

-- Completed sessions (history)
INSERT INTO "EV_ChargingSessions" (id, transaction_id, charger_id, connector_id, user_id, rfid_card_id, start_time, end_time, energy_kwh, start_meter, end_meter, amount, status, stop_reason) VALUES
  ('f0000002-0000-4000-8000-000000000001', 901, 'b0000001-0000-4000-8000-000000000001', 1, 'a0000001-0000-4000-8000-000000000001', 'd0000001-0000-4000-8000-000000000001', '2026-05-31 14:30:00+00', '2026-05-31 16:15:00+00', 42.3, 12450, 12873, 634.50, 'completed', 'EV Disconnected'),
  ('f0000002-0000-4000-8000-000000000002', 902, 'b0000001-0000-4000-8000-000000000002', 1, 'a0000001-0000-4000-8000-000000000002', 'd0000001-0000-4000-8000-000000000002', '2026-05-31 12:00:00+00', '2026-05-31 13:30:00+00', 38.7, 9800, 10187, 580.50, 'completed', 'EV Disconnected'),
  ('f0000002-0000-4000-8000-000000000003', 903, 'b0000001-0000-4000-8000-000000000005', 1, 'a0000001-0000-4000-8000-000000000003', 'd0000001-0000-4000-8000-000000000003', '2026-05-30 09:00:00+00', '2026-05-30 14:15:00+00', 35.8, 5670, 6028, 286.40, 'completed', 'Local'),
  ('f0000002-0000-4000-8000-000000000004', 904, 'b0000001-0000-4000-8000-000000000004', 1, 'a0000001-0000-4000-8000-000000000005', 'd0000001-0000-4000-8000-000000000005', '2026-05-30 16:00:00+00', '2026-05-30 17:20:00+00', 31.2, 3400, 3712, 468.00, 'completed', 'EV Disconnected')
ON CONFLICT (id) DO NOTHING;

INSERT INTO "EV_Payments" (id, session_id, user_id, amount, gst_amount, total_amount, status, gateway, gateway_txn_id, reconciliation_status, created_at) VALUES
  ('90000001-0000-4000-8000-000000000001', 'f0000002-0000-4000-8000-000000000001', 'a0000001-0000-4000-8000-000000000001', 597.00, 91.00, 688.00, 'success', 'SBIePay', 'SBI-20260531-001', 'matched', '2026-05-31 16:30:00+00'),
  ('90000001-0000-4000-8000-000000000002', 'f0000002-0000-4000-8000-000000000002', 'a0000001-0000-4000-8000-000000000002', 456.00, 69.50, 525.50, 'success', 'SBIePay', 'SBI-20260531-002', 'matched', '2026-05-31 14:15:00+00'),
  ('90000001-0000-4000-8000-000000000003', 'f0000002-0000-4000-8000-000000000003', 'a0000001-0000-4000-8000-000000000003', 134.40, 20.50, 154.90, 'success', 'SBIePay', 'SBI-20260601-001', 'matched', '2026-06-01 10:32:00+00'),
  ('90000001-0000-4000-8000-000000000004', 'f0000001-0000-4000-8000-000000000004', 'a0000001-0000-4000-8000-000000000004', 0, 0, 0, 'pending', NULL, NULL, 'unmatched', '2026-06-01 10:32:00+00'),
  ('90000001-0000-4000-8000-000000000005', 'f0000002-0000-4000-8000-000000000004', 'a0000001-0000-4000-8000-000000000005', 219.00, 33.40, 252.40, 'success', 'SBIePay', 'SBI-20260530-005', 'matched', '2026-05-30 11:45:00+00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO "EV_AuditLogs" (id, user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES
  ('ab000001-0000-4000-8000-000000000001', 'a0000001-0000-4000-8000-000000000006', 'User Created', 'User', 'a0000001-0000-4000-8000-000000000008', 'Created user Kavita Reddy with role Operator', '10.45.2.18', '2026-03-20 10:30:00+00'),
  ('ab000001-0000-4000-8000-000000000002', 'a0000001-0000-4000-8000-000000000006', 'RFID Bound', 'RFID', 'd0000001-0000-4000-8000-000000000007', 'Bound RFID-DFCCIL-007 to user Kavita Reddy', '10.45.2.18', '2026-03-20 10:32:00+00'),
  ('ab000001-0000-4000-8000-000000000003', 'a0000001-0000-4000-8000-000000000006', 'Tariff Created', 'Tariff', 'e0000001-0000-4000-8000-000000000003', 'Created DC Fast Peak Hours tariff at ₹18/kWh', '10.45.2.18', '2026-03-15 09:00:00+00'),
  ('ab000001-0000-4000-8000-000000000004', 'a0000001-0000-4000-8000-000000000001', 'Remote Start', 'Session', 'f0000001-0000-4000-8000-000000000002', 'Started charging on MP-DC-004 Gun 1', '10.45.2.22', '2026-05-29 15:00:00+00'),
  ('ab000001-0000-4000-8000-000000000005', 'a0000001-0000-4000-8000-000000000006', 'Login', 'Auth', 'a0000001-0000-4000-8000-000000000006', 'Successful login from 10.45.2.18', '10.45.2.18', '2026-06-01 08:00:00+00'),
  ('ab000001-0000-4000-8000-000000000006', 'a0000001-0000-4000-8000-000000000006', 'Charger Reset', 'Charger', 'b0000001-0000-4000-8000-000000000003', 'Sent Reset command to MP-DC-003 (faulted)', '10.45.2.18', '2026-06-01 09:10:00+00'),
  ('ab000001-0000-4000-8000-000000000007', 'a0000001-0000-4000-8000-000000000005', 'Login', 'Auth', 'a0000001-0000-4000-8000-000000000005', 'Successful login from 10.45.2.30', '10.45.2.30', '2026-06-01 08:30:00+00'),
  ('ab000001-0000-4000-8000-000000000008', 'a0000001-0000-4000-8000-000000000002', 'Login Failed', 'Auth', 'a0000001-0000-4000-8000-000000000002', 'Invalid password attempt from 10.45.3.12', '10.45.3.12', '2026-06-01 07:55:00+00'),
  ('ab000001-0000-4000-8000-000000000009', 'a0000001-0000-4000-8000-000000000001', 'Login', 'Auth', 'a0000001-0000-4000-8000-000000000001', 'Successful login from 10.45.2.22', '10.45.2.22', '2026-06-01 07:30:00+00'),
  ('ab000001-0000-4000-8000-000000000010', 'a0000001-0000-4000-8000-000000000003', 'Remote Start', 'Session', 'f0000001-0000-4000-8000-000000000003', 'Started charging on MP-AC-001 via RFID-DFCCIL-003', '10.45.2.25', '2026-06-01 07:45:00+00')
ON CONFLICT (id) DO NOTHING;
