import { protectedPayment } from "../../../server/payments/http.js";
export default async function handler(req, res) {
  return protectedPayment(req, res, "receipt");
}
