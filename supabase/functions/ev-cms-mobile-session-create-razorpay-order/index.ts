import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  isHdfcEnvConfigured,
  loadPaymentGatewayConfig,
} from "../_shared/paymentGateway.ts";

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

function basicAuth(keyId: string, keySecret: string): string {
  return `Basic ${btoa(`${keyId}:${keySecret}`)}`;
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
    const sessionId = String(body.session_id ?? "");
    if (!sessionId) {
      return json({ error: "session_id required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const gatewayConfig = await loadPaymentGatewayConfig(supabase);
    const activeGateway = gatewayConfig.active_gateway;
    console.log("[payment-order] gateway", activeGateway);

    if (activeGateway === "hdfc") {
      if (!isHdfcEnvConfigured()) {
        return json({ error: "HDFC payment gateway is not configured yet.", gateway: "hdfc", testing_mode: false }, 503);
      }
      // Full HDFC create will be added when client provides integration details.
      return json({ error: "HDFC payment gateway is not configured yet.", gateway: "hdfc", testing_mode: false }, 503);
    }

    const keyId = Deno.env.get("RAZORPAY_KEY_ID") ?? "";
    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET") ?? "";
    if (!keyId || !keySecret) {
      return json({ error: "Razorpay credentials not configured on server" }, 500);
    }

    const { error: syncErr } = await supabase.rpc("ev_sync_session_payment_bill", {
      p_user_id: userId,
      p_session_id: sessionId,
    });
    if (syncErr && !syncErr.message?.includes("ev_sync_session_payment_bill")) {
      return json({ error: syncErr.message }, 500);
    }

    const { data: paymentRows, error: paymentErr } = await supabase.rpc("ev_get_session_payment", {
      p_user_id: userId,
      p_session_id: sessionId,
    });

    if (paymentErr) {
      return json({ error: paymentErr.message }, 500);
    }
    if (!paymentRows?.[0]) {
      return json({ error: "Session payment not found" }, 404);
    }

    const payment = paymentRows[0] as Record<string, unknown>;
    const paymentId = payment.payment_id as string;
    const amount = Number(payment.amount);
    const gstAmount = Number(payment.gst_amount ?? 0);
    const totalAmount = Number(payment.total_amount ?? amount + gstAmount);
    const status = String(payment.status);

    if (status === "success" || status === "paid") {
      return json({ error: "PAYMENT_ALREADY_COMPLETED" }, 400);
    }

    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      return json({ error: "INVALID_AMOUNT" }, 400);
    }

    const existingOrderId = payment.gateway_order_id
      ? String(payment.gateway_order_id)
      : payment.gateway_txn_id
        ? String(payment.gateway_txn_id)
        : "";
    const amountPaise = Math.round(totalAmount * 100);

    if (amountPaise < 100) {
      return json({ error: "MINIMUM_PAYMENT_AMOUNT" }, 400);
    }

    const snapshotUpdate = {
      gateway: "razorpay",
      testing_mode: gatewayConfig.testing_mode,
      updated_at: new Date().toISOString(),
    };

    if (existingOrderId) {
      await supabase
        .from("EV_Payments")
        .update({
          ...snapshotUpdate,
          gateway_order_id: existingOrderId,
        })
        .eq("id", paymentId);

      console.log("[razorpay] order created (reuse)", existingOrderId);
      return json({
        gateway: "razorpay",
        testing_mode: gatewayConfig.testing_mode,
        payment_order_id: paymentId,
        razorpay_order_id: existingOrderId,
        gateway_order_id: existingOrderId,
        amount: totalAmount,
        amount_paise: amountPaise,
        currency: gatewayConfig.active_currency || "INR",
        key_id: keyId,
        status: "pending",
      });
    }

    const rzRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: basicAuth(keyId, keySecret),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: body.currency ?? gatewayConfig.active_currency ?? "INR",
        receipt: `session_${paymentId.replace(/-/g, "").slice(0, 20)}`,
        notes: {
          payment_id: paymentId,
          session_id: sessionId,
          user_id: userId,
          purpose: "session_payment",
          gateway: "razorpay",
          testing_mode: String(gatewayConfig.testing_mode),
        },
      }),
    });

    if (!rzRes.ok) {
      const errText = await rzRes.text();
      return json({ error: `Razorpay order failed: ${errText}` }, 502);
    }

    const rzOrder = await rzRes.json();
    console.log("[razorpay] order created", rzOrder.id);

    const { error: bindErr } = await supabase.rpc("ev_bind_session_razorpay_order", {
      p_user_id: userId,
      p_payment_id: paymentId,
      p_gateway_order_id: rzOrder.id,
    });

    if (bindErr) {
      return json({ error: bindErr.message }, 500);
    }

    await supabase
      .from("EV_Payments")
      .update({
        ...snapshotUpdate,
        gateway_order_id: rzOrder.id,
        gateway_txn_id: rzOrder.id,
        raw_gateway_response: { order_id: rzOrder.id, status: rzOrder.status },
      })
      .eq("id", paymentId);

    return json({
      gateway: "razorpay",
      testing_mode: gatewayConfig.testing_mode,
      payment_order_id: paymentId,
      razorpay_order_id: rzOrder.id,
      gateway_order_id: rzOrder.id,
      amount: totalAmount,
      amount_paise: amountPaise,
      currency: rzOrder.currency ?? "INR",
      key_id: keyId,
      status: "pending",
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
