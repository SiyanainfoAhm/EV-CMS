import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const keyId = Deno.env.get("RAZORPAY_KEY_ID") ?? "";
    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET") ?? "";
    if (!keyId || !keySecret) {
      return json({ error: "Razorpay credentials not configured on server" }, 500);
    }

    const userId = req.headers.get("x-user-id") ?? "";
    if (!userId) {
      return json({ error: "X-User-Id header required" }, 401);
    }

    const body = await req.json();
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 100) {
      return json({ error: "INVALID_AMOUNT" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: orderRows, error: orderErr } = await supabase.rpc("ev_create_topup_order", {
      p_user_id: userId,
      p_amount: amount,
      p_gateway_name: body.gateway_name ?? "razorpay",
    });

    if (orderErr || !orderRows?.[0]) {
      return json({ error: orderErr?.message ?? "Failed to create payment order" }, 500);
    }

    const paymentOrderId = orderRows[0].payment_order_id as string;
    const amountPaise = Math.round(amount * 100);

    const rzRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: basicAuth(keyId, keySecret),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: body.currency ?? "INR",
        receipt: `topup_${paymentOrderId.replace(/-/g, "").slice(0, 20)}`,
        notes: {
          payment_order_id: paymentOrderId,
          user_id: userId,
          purpose: "wallet_topup",
        },
      }),
    });

    if (!rzRes.ok) {
      const errText = await rzRes.text();
      await supabase
        .from("EV_PaymentOrders")
        .update({ status: "failed", failure_reason: errText.slice(0, 500), updated_at: new Date().toISOString() })
        .eq("id", paymentOrderId);
      return json({ error: `Razorpay order failed: ${errText}` }, 502);
    }

    const rzOrder = await rzRes.json();

    await supabase
      .from("EV_PaymentOrders")
      .update({
        status: "pending",
        gateway_name: "razorpay",
        gateway_order_id: rzOrder.id,
        updated_at: new Date().toISOString(),
        metadata: { razorpay_order: rzOrder },
      })
      .eq("id", paymentOrderId);

    return json({
      payment_order_id: paymentOrderId,
      razorpay_order_id: rzOrder.id,
      amount,
      amount_paise: amountPaise,
      currency: rzOrder.currency ?? "INR",
      key_id: keyId,
      status: "pending",
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
