import AsyncStorage from "@react-native-async-storage/async-storage";
import * as WebBrowser from "expo-web-browser";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { getSessionMeta } from "./authService";
import { backendEndpoint, invalidateSession } from "../utils/ssoTransport";
import { paymentReturnUri } from "../config/dfccilPaymentConfig";
const PENDING_KEY = "ev_cms_dfccil_payment_attempt";
export interface DfccilPaymentAttempt {
  attemptId: string;
  sessionId: string;
  paymentId: string;
  orderId: string | null;
  amount: number;
  creationState: "reserved" | "ready" | "unknown" | "rejected";
  reportedStatus: string | null;
  status:
    | "paid"
    | "failed"
    | "cancelled"
    | "pending_verification"
    | "creation_pending"
    | "pending";
  verified: boolean;
  canOpenCheckout: boolean;
  checkoutUrl: string | null;
  createdAt: string;
}
export function paymentApiUrl(action: string): string {
  return backendEndpoint("sso").replace(/\/sso$/, `/payments/dfccil/${action}`);
}
async function request(
  action: string,
  input: Record<string, unknown> = {},
): Promise<Response> {
  const token = getSessionMeta()?.token;
  if (!token) throw new Error("Sign in to continue.");
  const response = await fetch(paymentApiUrl(action), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(30000),
  });
  if (response.status === 401) invalidateSession();
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.error ||
        "Payment service is unavailable. Check payment status before retrying.",
    );
  }
  return response;
}
export async function paymentAvailability(): Promise<boolean> {
  const body = await (await request("config")).json();
  return body.enabled === true;
}
export async function paymentStatus(
  input: { sessionId: string } | { attemptId: string },
): Promise<DfccilPaymentAttempt | null> {
  return (await (await request("status", input)).json()).attempt;
}
export async function paymentAttempts(): Promise<DfccilPaymentAttempt[]> {
  return (await (await request("history")).json()).attempts;
}
export async function createPayment(
  sessionId: string,
): Promise<DfccilPaymentAttempt> {
  const result = await (await request("create", { sessionId })).json();
  if (!result.attempt?.attemptId)
    throw new Error(
      "Invalid payment response. Check payment status before retrying.",
    );
  return result.attempt;
}
export function returnedAttempt(url: string): string | null {
  try {
    const parsed = new URL(url);
    const expected = new URL(paymentReturnUri);
    if (
      parsed.protocol !== expected.protocol ||
      parsed.host !== expected.host ||
      parsed.pathname !== expected.pathname ||
      parsed.searchParams.getAll("attemptId").length !== 1
    )
      return null;
    const id = parsed.searchParams.get("attemptId") || "";
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      id,
    )
      ? id
      : null;
  } catch {
    return null;
  }
}
export async function openPayment(
  attempt: DfccilPaymentAttempt,
): Promise<void> {
  if (!attempt.canOpenCheckout || !attempt.checkoutUrl || !attempt.orderId)
    throw new Error(
      "Check the existing payment status before making another payment.",
    );
  const expected = `https://epay.dfccil.com/Payment/Pay/${encodeURIComponent(attempt.orderId)}`;
  if (attempt.checkoutUrl !== expected)
    throw new Error("Unexpected payment checkout address.");
  await AsyncStorage.setItem(PENDING_KEY, attempt.attemptId);
  // A return URL is navigation only. All displayed financial state is loaded from the authenticated API.
  await WebBrowser.openAuthSessionAsync(attempt.checkoutUrl, paymentReturnUri);
}
export async function pendingPayment(): Promise<string | null> {
  return AsyncStorage.getItem(PENDING_KEY);
}
export async function clearPendingPayment(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_KEY);
}
export async function officialReceiptFile(attemptId: string): Promise<string> {
  const response = await request("receipt", { attemptId });
  if (!response.headers.get("content-type")?.includes("application/pdf"))
    throw new Error("Invalid receipt response");
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const uri = `${FileSystem.cacheDirectory}DFCCIL-${attemptId}.pdf`;
  await FileSystem.writeAsStringAsync(uri, btoa(binary), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return uri;
}
export async function shareOfficialReceipt(attemptId: string): Promise<void> {
  const uri = await officialReceiptFile(attemptId);
  if (!(await Sharing.isAvailableAsync()))
    throw new Error("Receipt sharing is not available on this device.");
  await Sharing.shareAsync(uri, {
    mimeType: "application/pdf",
    dialogTitle: "DFCCIL payment receipt",
  });
}
