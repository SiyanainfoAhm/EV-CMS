import { protectedPayment } from "../../../server/payments/http.js";
import { productionTestHandler } from "../../../server/payments/production-test.js";
import { mockPaymentHandler } from "../../../server/payments/mock.js";
const productionTest = productionTestHandler();
const mock = mockPaymentHandler();
export default async function handler(req, res) {
  const mode = req.query?.paymentTest;
  if (mode === "production") return productionTest(req, res);
  if (mode === "mock") return mock(req, res);
  return protectedPayment(req, res, "config");
}
