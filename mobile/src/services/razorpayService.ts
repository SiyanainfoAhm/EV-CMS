import Constants from "expo-constants";
import { NativeModules } from "react-native";
import RazorpayCheckout from "react-native-razorpay";
import { paymentConfig } from "../config/paymentConfig";

function getRazorpayNativeModule(): { open?: (options: unknown) => void } | null {
  const mod = NativeModules.RNRazorpayCheckout as { open?: (options: unknown) => void } | undefined;
  if (mod && typeof mod.open === "function") return mod;
  return null;
}

export function isRazorpayNativeAvailable(): boolean {
  if (Constants.appOwnership === "expo") return false;
  return getRazorpayNativeModule() != null;
}

export function getRazorpayNativeUnavailableReason(): string {
  if (Constants.appOwnership === "expo") return "RAZORPAY_REQUIRES_DEV_BUILD";
  return "RAZORPAY_NATIVE_UNAVAILABLE";
}

function assertRazorpayNativeAvailable(): void {
  if (!isRazorpayNativeAvailable()) {
    throw new Error(getRazorpayNativeUnavailableReason());
  }
}

function isRazorpayNativeLinkError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return /cannot read propert(?:y|ies) of undefined \(reading 'open'\)/i.test(message);
}

export type CreateRazorpayOrderResponse = {
  payment_order_id: string;
  razorpay_order_id: string;
  gateway_order_id?: string;
  gateway?: "razorpay" | "hdfc";
  testing_mode?: boolean;
  amount: number;
  amount_paise: number;
  currency: string;
  key_id: string;
  status: string;
  checkout_url?: string;
  checkout_payload?: Record<string, string>;
  prefill?: {
    name?: string;
    email?: string;
    contact?: string;
  };
};

export type RazorpayCheckoutOptions = {
  description?: string;
  purpose?: string;
  sessionId?: string;
};

export async function openRazorpayCheckout(
  order: CreateRazorpayOrderResponse,
  options: RazorpayCheckoutOptions = {}
) {
  if (!paymentConfig.gatewayEnabled) {
    throw new Error("PAYMENT_GATEWAY_DISABLED");
  }

  assertRazorpayNativeAvailable();

  const key = order.key_id || paymentConfig.razorpayKeyId;

  if (!key) {
    throw new Error("RAZORPAY_KEY_MISSING");
  }

  try {
    return await RazorpayCheckout.open({
      key,
      amount: order.amount_paise,
      currency: order.currency || "INR",
      name: "EV CMS",
      description: options.description ?? "EV charging payment",
      order_id: order.razorpay_order_id,
      prefill: order.prefill,
      theme: {
        color: paymentConfig.themeColor,
      },
      notes: {
        payment_order_id: order.payment_order_id,
        purpose: options.purpose ?? "session_payment",
        ...(options.sessionId ? { session_id: options.sessionId } : {}),
      },
      retry: {
        enabled: true,
        max_count: 1,
      },
    });
  } catch (e) {
    if (isRazorpayNativeLinkError(e)) {
      throw new Error(getRazorpayNativeUnavailableReason());
    }
    throw e;
  }
}

export function isRazorpayUserCancelled(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string | number; description?: string };
  if (e.code === "user_cancelled" || e.code === 0) return true;
  const desc = (e.description ?? "").toLowerCase();
  return desc.includes("cancelled") || desc.includes("canceled");
}
