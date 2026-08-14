/** Shared form validators — return error message or null if valid */

const GENERIC_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RFID_UID = /^[A-Za-z0-9-]{6,32}$/;
const PHONE_IN = /^(\+91[\s-]?)?[6-9]\d{9}$/;
const NAME_MIN = 2;
const NAME_MAX = 80;

export type ValidationResult = string | null;

export function validateRequired(value: string, label: string): ValidationResult {
  if (!value?.trim()) return `${label} is required`;
  return null;
}

export function validateEmail(email: string): ValidationResult {
  const trimmed = email.trim();
  if (!trimmed) return "Email is required";
  if (!GENERIC_EMAIL.test(trimmed)) return "Enter a valid email address";
  return null;
}

export function validatePassword(password: string, minLength = 8): ValidationResult {
  if (!password) return "Password is required";
  if (password.length < minLength) return `Password must be at least ${minLength} characters`;
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must include at least one letter and one number";
  }
  return null;
}

export function validateLoginPassword(password: string): ValidationResult {
  if (!password) return "Password is required";
  if (password.length < 6) return "Password is too short";
  return null;
}

export function validatePasswordChange(
  current: string,
  next: string,
  confirm: string
): ValidationResult {
  if (!current) return "Current password is required";
  const nextErr = validatePassword(next);
  if (nextErr) return nextErr;
  if (next !== confirm) return "New passwords do not match";
  if (current === next) return "New password must be different from current password";
  return null;
}

export function validateName(name: string): ValidationResult {
  const trimmed = name.trim();
  if (!trimmed) return "Full name is required";
  if (trimmed.length < NAME_MIN) return `Name must be at least ${NAME_MIN} characters`;
  if (trimmed.length > NAME_MAX) return `Name must be under ${NAME_MAX} characters`;
  if (!/^[a-zA-Z\u00C0-\u024F\s.'-]+$/.test(trimmed)) return "Name contains invalid characters";
  return null;
}

export function validatePhone(phone: string, required = false): ValidationResult {
  const trimmed = phone.trim();
  if (!trimmed) return required ? "Phone number is required" : null;
  const normalized = trimmed.replace(/\s/g, "");
  if (!PHONE_IN.test(normalized) && !/^\+?[0-9]{10,15}$/.test(normalized)) {
    return "Enter a valid Indian mobile number (10 digits)";
  }
  return null;
}

export function validateRfidUid(uid: string): ValidationResult {
  const trimmed = uid.trim();
  if (!trimmed) return "RFID UID is required";
  if (!RFID_UID.test(trimmed)) {
    return "UID must be 6–32 characters (letters, numbers, hyphens)";
  }
  return null;
}

export function validateTariffName(name: string): ValidationResult {
  const err = validateRequired(name, "Tariff name");
  if (err) return err;
  if (name.trim().length > 100) return "Name must be under 100 characters";
  return null;
}

export function validatePositiveNumber(
  value: number,
  label: string,
  options?: { min?: number; max?: number; allowZero?: boolean }
): ValidationResult {
  if (Number.isNaN(value)) return `${label} must be a number`;
  if (!options?.allowZero && value <= 0) return `${label} must be greater than zero`;
  if (options?.allowZero && value < 0) return `${label} cannot be negative`;
  if (options?.min != null && value < options.min) return `${label} must be at least ${options.min}`;
  if (options?.max != null && value > options.max) return `${label} must be at most ${options.max}`;
  return null;
}

export function validateGstPercent(value: number): ValidationResult {
  return validatePositiveNumber(value, "GST", { min: 0, max: 28, allowZero: true });
}

export interface UserFormFields {
  name: string;
  email: string;
  role: string;
  department: string;
  joinedDate: string;
  status: "active" | "inactive";
}

export function validateUserForm(data: UserFormFields): Partial<Record<keyof UserFormFields, string>> {
  const errors: Partial<Record<keyof UserFormFields, string>> = {};
  const nameErr = validateName(data.name);
  if (nameErr) errors.name = nameErr;
  const emailErr = validateEmail(data.email);
  if (emailErr) errors.email = emailErr;
  if (!data.role) errors.role = "Role is required";
  if (!data.department) errors.department = "Department is required";
  if (!data.joinedDate?.trim()) {
    errors.joinedDate = "Joining date is required";
  } else if (Number.isNaN(new Date(data.joinedDate).getTime())) {
    errors.joinedDate = "Invalid joining date";
  }
  if (data.status !== "active" && data.status !== "inactive") {
    errors.status = "Status is required";
  }
  return errors;
}

export interface TariffFormFields {
  name: string;
  ratePerKwh: number;
  sessionFee: number;
  gstPercent: number;
  appliesTo: string;
}

export function validateTariffForm(data: TariffFormFields): Partial<Record<keyof TariffFormFields, string>> {
  const errors: Partial<Record<keyof TariffFormFields, string>> = {};
  const nameErr = validateTariffName(data.name);
  if (nameErr) errors.name = nameErr;
  const rateErr = validatePositiveNumber(data.ratePerKwh, "Rate per kWh", { min: 0.01, max: 500 });
  if (rateErr) errors.ratePerKwh = rateErr;
  const feeErr = validatePositiveNumber(data.sessionFee, "Session fee", { min: 0, max: 10000, allowZero: true });
  if (feeErr) errors.sessionFee = feeErr;
  const gstErr = validateGstPercent(data.gstPercent);
  if (gstErr) errors.gstPercent = gstErr;
  if (!data.appliesTo) errors.appliesTo = "Applies-to is required";
  return errors;
}

export interface ProfileFormFields {
  name: string;
  email: string;
  department: string;
  phone: string;
}

export function validateProfileForm(data: ProfileFormFields): Partial<Record<keyof ProfileFormFields, string>> {
  const errors: Partial<Record<keyof ProfileFormFields, string>> = {};
  const nameErr = validateName(data.name);
  if (nameErr) errors.name = nameErr;
  const emailErr = validateEmail(data.email);
  if (emailErr) errors.email = emailErr;
  if (!data.department) errors.department = "Department is required";
  const phoneErr = validatePhone(data.phone, false);
  if (phoneErr) errors.phone = phoneErr;
  return errors;
}

export interface ChargerFormFields {
  chargePointId: string;
  name: string;
  /** Optional public label stored in display_name; leave blank to use name. */
  displayName: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  firmwareVersion: string;
  chargerType: string;
  maxPowerKw: number;
  location: string;
  tariffId: string;
  allowAdminBypass?: boolean;
}

const CHARGE_POINT_ID = /^[A-Z0-9][A-Z0-9-]{2,31}$/;

export function validateChargePointId(id: string): ValidationResult {
  const trimmed = id.trim().toUpperCase();
  if (!trimmed) return "Charge point ID is required";
  if (!CHARGE_POINT_ID.test(trimmed)) {
    return "Use 3–32 characters: letters, numbers, hyphens (e.g. MP-DC-001)";
  }
  return null;
}

export function validateChargerForm(data: ChargerFormFields): Partial<Record<keyof ChargerFormFields, string>> {
  const errors: Partial<Record<keyof ChargerFormFields, string>> = {};
  const cpErr = validateChargePointId(data.chargePointId);
  if (cpErr) errors.chargePointId = cpErr;
  return { ...errors, ...validateChargerFormFields(data) };
}

/** Edit form — charge point ID is fixed after registration. */
export function validateChargerEditForm(data: ChargerFormFields): Partial<Record<keyof ChargerFormFields, string>> {
  return validateChargerFormFields(data);
}

function validateChargerFormFields(
  data: ChargerFormFields
): Partial<Record<keyof ChargerFormFields, string>> {
  const errors: Partial<Record<keyof ChargerFormFields, string>> = {};
  const nameErr = validateRequired(data.name, "Charger name");
  if (nameErr) errors.name = nameErr;
  if (!data.manufacturer) errors.manufacturer = "Manufacturer is required";
  if (!data.chargerType) errors.chargerType = "Charger type is required";
  const powerErr = validatePositiveNumber(data.maxPowerKw, "Max power (kW)", { min: 1, max: 500 });
  if (powerErr) errors.maxPowerKw = powerErr;
  const locErr = validateRequired(data.location, "Location");
  if (locErr) errors.location = locErr;
  return errors;
}

export function hasErrors(errors: object): boolean {
  return Object.keys(errors).length > 0;
}
