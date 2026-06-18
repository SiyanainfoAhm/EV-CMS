import { useEffect } from "react";
import { loadOcppGatewayConfig } from "@/utils/ocppUrls";

/** Preloads optional /app-config.json for OCPP gateway URL on production. */
export default function OcppConfigLoader() {
  useEffect(() => {
    void loadOcppGatewayConfig();
  }, []);
  return null;
}
