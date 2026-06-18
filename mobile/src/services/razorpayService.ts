import RazorpayCheckout from "react-native-razorpay";
import { paymentConfig } from "../config/paymentConfig";

export type CreateRazorpayOrderResponse = {
  payment_order_id: string;
  razorpay_order_id: string;
  amount: number;
  amount_paise: number;
  currency: string;
  key_id: string;
  status: string;
  prefill?: {
    name?: string;
    email?: string;
    contact?: string;
  };
};

export async function openRazorpayCheckout(order: CreateRazorpayOrderResponse) {
  if (!paymentConfig.gatewayEnabled) {
    throw new Error("PAYMENT_GATEWAY_DISABLED");
  }

  const key = order.key_id || paymentConfig.razorpayKeyId;

  if (!key) {
    throw new Error("RAZORPAY_KEY_MISSING");
  }

  return RazorpayCheckout.open({
    key,
    amount: order.amount_paise,
    currency: order.currency || "INR",
    name: "EV CMS",
    description: "Wallet Top-up",
    order_id: order.razorpay_order_id,
    prefill: order.prefill,
    theme: {
      color: paymentConfig.themeColor,
    },
    notes: {
      payment_order_id: order.payment_order_id,
      purpose: "wallet_topup",
    },
    retry: {
      enabled: true,
      max_count: 1,
    },
  });
}

export function isRazorpayUserCancelled(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string | number; description?: string };
  if (e.code === "user_cancelled" || e.code === 0) return true;
  const desc = (e.description ?? "").toLowerCase();
  return desc.includes("cancelled") || desc.includes("canceled");
}
