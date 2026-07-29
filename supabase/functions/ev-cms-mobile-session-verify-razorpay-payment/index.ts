import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadPaymentGatewayConfig } from "../_shared/paymentGateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-user-id",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function verifyRazorpaySignature(
  orderId: string,
  paymentId: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const data = new TextEncoder().encode(`${orderId}|${paymentId}`);
  const sig = await crypto.subtle.sign("HMAC", key, data);
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return expected === signature;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const userId = req.headers.get("x-user-id") ?? "";
    if (!userId) {
      return json({ error: "X-User-Id header required" }, 401);
    }

    const body = await req.json();
    const requestedGateway = String(body.gateway ?? "razorpay").toLowerCase();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const gatewayConfig = await loadPaymentGatewayConfig(supabase);

    if (requestedGateway === "hdfc" || gatewayConfig.active_gateway === "hdfc") {
      if (String(body.gateway ?? "") === "hdfc") {
        return json({ error: "HDFC payment gateway is not configured yet.", gateway: "hdfc" }, 503);
      }
    }

    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET") ?? "";
    if (!keySecret) {
      return json({ error: "Razorpay credentials not configured on server" }, 500);
    }

    const paymentId = String(body.payment_order_id ?? body.payment_id ?? "");
    const razorpayOrderId = String(body.razorpay_order_id ?? body.gateway_order_id ?? "");
    const razorpayPaymentId = String(body.razorpay_payment_id ?? body.gateway_payment_id ?? "");
    const razorpaySignature = String(body.razorpay_signature ?? body.gateway_signature ?? "");

    if (!paymentId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return json({ error: "Missing Razorpay verification fields" }, 400);
    }

    const valid = await verifyRazorpaySignature(
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      keySecret
    );

    if (!valid) {
      return json({ error: "Invalid Razorpay signature" }, 400);
    }

    console.log("[razorpay] payment verified", razorpayPaymentId);

    const { data, error } = await supabase.rpc("ev_complete_session_razorpay_payment", {
      p_user_id: userId,
      p_payment_id: paymentId,
      p_gateway_order_id: razorpayOrderId,
      p_gateway_payment_id: razorpayPaymentId,
    });

    if (error) {
      return json({ error: error.message }, 500);
    }

    const row = (data as Record<string, unknown>[] | null)?.[0];
    if (!row) {
      return json({ error: "Session payment completion failed" }, 500);
    }

    await supabase
      .from("EV_Payments")
      .update({
        gateway: "razorpay",
        gateway_order_id: razorpayOrderId,
        gateway_payment_id: razorpayPaymentId,
        testing_mode: gatewayConfig.testing_mode,
        updated_at: new Date().toISOString(),
      })
      .eq("id", paymentId);

    console.log("[payment] normalized status", "paid");

    return json({
      gateway: "razorpay",
      testing_mode: gatewayConfig.testing_mode,
      payment_id: row.payment_id,
      session_id: row.session_id,
      amount: Number(row.amount),
      status: row.status,
      receipt_number: row.receipt_number ?? null,
      gateway_order_id: row.gateway_order_id ?? razorpayOrderId,
      gateway_payment_id: row.gateway_payment_id ?? razorpayPaymentId,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
