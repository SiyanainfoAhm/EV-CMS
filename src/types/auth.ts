/** RFP roles; legacy DB values Operator/Viewer map to User in app layer. */
export type UserRole = "SuperAdmin" | "SiteAdmin" | "User";

export type UserStatus = "active" | "inactive" | "suspended";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  department?: string;
  status: UserStatus;
  phone?: string;
  avatarUrl?: string | null;
  employeeId?: string | null;
}

export interface AuthSession {
  token: string;
  user: AuthUser;
  expiresAt: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface LoginResult {
  success: boolean;
  session?: AuthSession;
  error?: string;
}
