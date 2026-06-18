declare module "react-native-razorpay" {
  type RazorpayOptions = {
    description?: string;
    image?: string;
    currency?: string;
    key: string;
    amount: number;
    name: string;
    order_id?: string;
    prefill?: {
      email?: string;
      contact?: string;
      name?: string;
    };
    theme?: {
      color?: string;
    };
    notes?: Record<string, string>;
    readonly?: Record<string, boolean>;
    hidden?: Record<string, boolean>;
    retry?: {
      enabled?: boolean;
      max_count?: number;
    };
  };

  type RazorpaySuccessResponse = {
    razorpay_payment_id: string;
    razorpay_order_id?: string;
    razorpay_signature?: string;
  };

  type RazorpayErrorResponse = {
    code?: string | number;
    description?: string;
    source?: string;
    step?: string;
    reason?: string;
    metadata?: Record<string, unknown>;
  };

  const RazorpayCheckout: {
    open(options: RazorpayOptions): Promise<RazorpaySuccessResponse>;
  };

  export default RazorpayCheckout;
}
