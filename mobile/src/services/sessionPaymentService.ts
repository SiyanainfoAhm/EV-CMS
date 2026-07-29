import { paymentConfig } from "../config/paymentConfig";
import { requireSupabase } from "../utils/supabaseClient";
import { requireUserId } from "./authService";
import type { CreateRazorpayOrderResponse } from "./razorpayService";

export type RazorpaySessionVerifyPayload = {
  payment_order_id: string;
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

export type SessionPaymentVerifyResponse = {
  payment_id: string;
  session_id: string;
  amount: number;
  status: string;
  receipt_number?: string | null;
  gateway_order_id?: string | null;
  gateway_payment_id?: string | null;
};

const RAZORPAY_FUNCTION_BY_PATH: Record<string, string> = {
  "/mobile/session/payment/create-razorpay-order": "ev-cms-mobile-session-create-razorpay-order",
  "/mobile/session/payment/verify-razorpay-payment": "ev-cms-mobile-session-verify-razorpay-payment",
};

function getAnonKey(): string {
  return process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";
}

async function parseErrorBody(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    if (body?.error) return body.error;
    if (body?.message) return body.message;
  } catch {
    // fall through
  }
  try {
    const text = await response.text();
    if (text) return text;
  } catch {
    // fall through
  }
  return `Payment service error (${response.status})`;
}

async function readEdgeFunctionError(error: unknown): Promise<string> {
  if (!error || typeof error !== "object") return "PAYMENT_FAILED";

  const err = error as {
    message?: string;
    context?: Response | { json?: () => Promise<unknown>; text?: () => Promise<string> };
  };

  if (err.context instanceof Response) {
    return parseErrorBody(err.context);
  }

  if (err.context?.json) {
    try {
      const body = (await err.context.json()) as { error?: string };
      if (body?.error) return body.error;
    } catch {
      // fall through
    }
  }

  if (err.context?.text) {
    try {
      const text = await err.context.text();
      if (text) {
        try {
          const body = JSON.parse(text) as { error?: string };
          if (body?.error) return body.error;
        } catch {
          return text;
        }
      }
    } catch {
      // fall through
    }
  }

  const message = err.message || "PAYMENT_FAILED";
  if (message.includes("non-2xx")) {
    return "SESSION_PAYMENT_EDGE_FUNCTION_FAILED";
  }
  return message;
}

async function invokeSessionEdgeFunction<T>(functionName: string, body: unknown): Promise<T> {
  const supabaseUrl = paymentConfig.supabaseUrl;
  const anonKey = getAnonKey();
  const userId = requireUserId();

  if (!supabaseUrl || !anonKey) {
    throw new Error("SESSION_PAYMENT_BACKEND_NOT_CONFIGURED");
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
      "X-User-Id": userId,
    },
    body: JSON.stringify(body),
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

    if (!response.ok) {
    const detail =
      payload && typeof payload === "object" && payload !== null && "error" in payload
        ? String((payload as { error: string }).error)
        : `Payment service error (${response.status})`;
    if (response.status === 404) {
      throw new Error("SESSION_PAYMENT_EDGE_FUNCTION_NOT_DEPLOYED");
    }
    throw new Error(detail);
  }

  if (payload && typeof payload === "object" && payload !== null && "error" in payload) {
    throw new Error(String((payload as { error: string }).error));
  }

  return payload as T;
}

async function mobileSessionPost<T>(path: string, body: unknown): Promise<T> {
  const functionName = RAZORPAY_FUNCTION_BY_PATH[path];
  if (!functionName) {
    throw new Error("SESSION_PAYMENT_BACKEND_NOT_CONFIGURED");
  }

  try {
    return await invokeSessionEdgeFunction<T>(functionName, body);
  } catch (directError) {
    const directMessage = directError instanceof Error ? directError.message : "PAYMENT_FAILED";
    if (
      directMessage !== "SESSION_PAYMENT_EDGE_FUNCTION_FAILED" &&
      directMessage !== "PAYMENT_FAILED"
    ) {
      throw directError;
    }

    const userId = requireUserId();
    const { data, error } = await requireSupabase().functions.invoke(functionName, {
      body: body as Record<string, unknown>,
      headers: { "X-User-Id": userId } as Record<string, string>,
    });

    if (error) {
      throw new Error(await readEdgeFunctionError(error));
    }

    if (data && typeof data === "object" && "error" in data) {
      throw new Error(String((data as { error: string }).error));
    }

    return data as T;
  }
}

export async function syncSessionPaymentBill(sessionId: string): Promise<void> {
  const uid = requireUserId();
  const { error } = await requireSupabase().rpc("ev_sync_session_payment_bill", {
    p_user_id: uid,
    p_session_id: sessionId,
  });
  if (error && !error.message?.includes("ev_sync_session_payment_bill")) {
    throw error;
  }
}

export async function createRazorpaySessionOrder(sessionId: string): Promise<CreateRazorpayOrderResponse> {
  if (!paymentConfig.supabaseUrl) {
    throw new Error("SESSION_PAYMENT_BACKEND_NOT_CONFIGURED");
  }

  await syncSessionPaymentBill(sessionId);

  return mobileSessionPost<CreateRazorpayOrderResponse>("/mobile/session/payment/create-razorpay-order", {
    session_id: sessionId,
    currency: "INR",
  });
}

export async function verifyRazorpaySessionPayment(
  payload: RazorpaySessionVerifyPayload
): Promise<SessionPaymentVerifyResponse> {
  return mobileSessionPost<SessionPaymentVerifyResponse>("/mobile/session/payment/verify-razorpay-payment", payload);
}

export function mapSessionPaymentErrorMessage(code: string): string {
  switch (code) {
    case "SESSION_PAYMENT_EDGE_FUNCTION_NOT_DEPLOYED":
    case "SESSION_PAYMENT_EDGE_FUNCTION_FAILED":
      return "session.paymentEdgeFunctionFailed";
    case "SESSION_PAYMENT_BACKEND_NOT_CONFIGURED":
    case "Razorpay credentials not configured on server":
      return "razorpay.gatewayNotConfigured";
    case "HDFC payment gateway is not configured yet.":
      return "HDFC payment gateway is not configured yet.";
    case "Session payment not found":
    case "PAYMENT_NOT_FOUND":
      return "session.paymentNotFound";
    case "INVALID_AMOUNT":
    case "MINIMUM_PAYMENT_AMOUNT":
      return "session.paymentAmountInvalid";
    case "PAYMENT_ALREADY_COMPLETED":
      return "session.paymentCompleted";
    default:
      return code;
  }
}
