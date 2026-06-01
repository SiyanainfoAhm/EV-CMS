# EV Charger Management System (CMS) - DFCCIL

## 1. Project Description
A private cloud-based EV Charger Management System for DFCCIL to manage 12 EV chargers across their sites. The system provides real-time charger monitoring, remote control, RFID-based authentication, billing, and comprehensive reporting. Only authorized DFCCIL personnel can access the system.

**Charger Fleet:**
- MyPower Experts 30+30 kW Double Gun Fast Charger × 4
- MyPower Experts 7.5 kW Single Gun Slow Charger × 6
- Tri Square 30+30 kW Double Gun Fast Charger × 1
- Tri Square 7.4 kW Single Gun Slow Charger × 1

## 2. Page Structure
- `/login` - Login page
- `/` - Dashboard (summary overview)
- `/chargers` - Charger list & status
- `/chargers/:id` - Charger detail & connector status
- `/sessions` - Active & historical charging sessions
- `/users` - User management
- `/rfid` - RFID card/tag management
- `/tariffs` - Tariff configuration
- `/payments` - Payment records
- `/reports` - Reports dashboard
- `/audit-logs` - Audit trail
- `/settings` - Settings & profile management

## 3. Core Features
- [x] Login & Role-based Authentication
- [x] Dashboard with live summary stats
- [x] Charger list with real-time status
- [x] Charger detail with connector status per gun
- [x] Active charging sessions tracking
- [x] Remote Start/Stop/Reset commands
- [x] User management (CRUD)
- [x] RFID card management & binding
- [x] Tariff configuration (per kWh, session fee, GST)
- [x] Payment records & reconciliation
- [x] Reports (charger-wise, user-wise, revenue, faults)
- [x] Audit logs with filtering and pagination
- [x] Settings & profile management (personal info, security, notifications, system prefs)
- [ ] Firmware update management

## 4. Data Model Design
(For Supabase database - documented for reference)

### Table: organizations
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| name | text | Organization name (DFCCIL) |
| created_at | timestamptz | Created timestamp |

### Table: users
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| org_id | uuid | FK → organizations.id |
| email | text | Unique email |
| name | text | Full name |
| role | text | admin/operator/viewer |
| password_hash | text | Hashed password |
| is_active | boolean | Active status |
| created_at | timestamptz | Created timestamp |

### Table: chargers
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| org_id | uuid | FK → organizations.id |
| charge_point_id | text | OCPP charge point identifier |
| name | text | Display name |
| manufacturer | text | MyPower Experts / Tri Square |
| model | text | Charger model |
| serial_number | text | Serial number |
| firmware_version | text | Current firmware |
| status | text | online/offline/faulted |
| last_heartbeat | timestamptz | Last heartbeat time |
| location | text | Physical location |
| created_at | timestamptz | Created timestamp |

### Table: connectors
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| charger_id | uuid | FK → chargers.id |
| connector_id | int | OCPP connector number (1, 2) |
| type | text | CCS2/Type2 |
| max_power_kw | decimal | Max power |
| status | text | Available/Charging/Faulted/Unavailable |
| created_at | timestamptz | Created timestamp |

### Table: rfid_cards
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| org_id | uuid | FK → organizations.id |
| user_id | uuid | FK → users.id (nullable) |
| rfid_uid | text | RFID tag UID |
| status | text | active/inactive/blocked |
| created_at | timestamptz | Created timestamp |

### Table: charging_sessions
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| charger_id | uuid | FK → chargers.id |
| connector_id | uuid | FK → connectors.id |
| user_id | uuid | FK → users.id |
| rfid_id | uuid | FK → rfid_cards.id |
| transaction_id | int | OCPP transaction ID |
| id_tag | text | RFID used |
| start_time | timestamptz | Session start |
| end_time | timestamptz | Session end |
| start_meter | decimal | Start meter (Wh) |
| end_meter | decimal | End meter (Wh) |
| energy_kwh | decimal | Energy consumed |
| status | text | active/completed/stopped/faulted |
| stop_reason | text | Reason for stop |

### Table: meter_values
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| session_id | uuid | FK → charging_sessions.id |
| connector_id | uuid | FK → connectors.id |
| value | decimal | Meter value (Wh) |
| context | text | Sample.Periodic / Transaction.Begin / Transaction.End |
| format | text | Raw / SignedData |
| measurand | text | Energy.Active.Import.Register |
| timestamp | timestamptz | Sample timestamp |

### Table: tariffs
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| org_id | uuid | FK → organizations.id |
| name | text | Tariff name |
| rate_per_kwh | decimal | Rate in INR |
| session_fee | decimal | Fixed session fee |
| gst_percent | decimal | GST percentage |
| is_active | boolean | Active status |
| created_at | timestamptz | Created timestamp |

### Table: payments
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| session_id | uuid | FK → charging_sessions.id |
| amount | decimal | Payment amount |
| gst_amount | decimal | GST amount |
| total_amount | decimal | Total amount |
| status | text | pending/success/failed/refunded |
| gateway | text | Payment gateway |
| gateway_txn_id | text | Gateway transaction ID |
| created_at | timestamptz | Created timestamp |

### Table: receipts
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| payment_id | uuid | FK → payments.id |
| session_id | uuid | FK → charging_sessions.id |
| receipt_number | text | Unique receipt number |
| pdf_url | text | Receipt PDF URL |
| created_at | timestamptz | Created timestamp |

### Table: audit_logs
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| user_id | uuid | FK → users.id |
| action | text | Action performed |
| entity_type | text | Target entity type |
| entity_id | text | Target entity ID |
| details | jsonb | Action details |
| ip_address | text | Client IP |
| created_at | timestamptz | Created timestamp |

### Table: firmware_commands
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| charger_id | uuid | FK → chargers.id |
| firmware_url | text | Firmware file URL |
| status | text | pending/in_progress/success/failed |
| initiated_by | uuid | FK → users.id |
| created_at | timestamptz | Created timestamp |

## 5. Backend / Third-party Integration Plan

- **Supabase**: Database, authentication (JWT), real-time subscriptions for charger status, edge functions for API endpoints
- **OCPP 1.6J Server**: Standalone Node.js WebSocket server (separate project, not part of this React SPA)
- **Payment Gateway**: To be integrated via Supabase Edge Functions when DFCCIL provides credentials
- **Mobile App**: Separate Flutter/React Native project (not part of this React SPA)

## 6. Development Phase Plan

### Phase 1: Admin Dashboard - Authentication & Core Layout ✅
- Goal: Login page with mock auth, sidebar navigation layout, dashboard overview
- Deliverable: Login page + Dashboard layout + Summary cards
- Status: Complete

### Phase 2: Charger Management Screens ✅
- Goal: Charger list, charger detail with connector status, live status simulation
- Deliverable: Chargers page + Charger detail page
- Status: Complete

### Phase 3: Session Management & Remote Commands ✅
- Goal: Active sessions view, session history, remote start/stop/reset UI
- Deliverable: Sessions page + Remote command modals
- Status: Complete

### Phase 4: User & RFID Management ✅
- Goal: User CRUD, RFID card management, binding/unbinding
- Deliverable: Users page + RFID page
- Status: Complete

### Phase 5: Tariff, Payments & Billing ✅
- Goal: Tariff configuration, payment records, receipt generation UI
- Deliverable: Tariffs page + Payments page
- Status: Complete

### Phase 6: Reports & Audit ✅
- Goal: Reports dashboard with charts, audit logs viewer
- Deliverable: Reports page + Audit logs page
- Status: Complete

### Phase 7: Supabase Integration (requires Supabase connection)
- Goal: Connect real database, authentication, real-time status
- Deliverable: Working connected backend

### Phase 8: Settings & Profile Management ✅
- Goal: Admin profile editing, password change, notification preferences, system settings
- Deliverable: Settings page with 4 tabs — Profile, Security, Notifications, System
- Status: Complete