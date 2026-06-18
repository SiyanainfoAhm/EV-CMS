import { useEffect, useState } from "react";
import {
  buildOcppWebSocketUrl,
  getGatewayRestUrl,
  isOcppGatewayConfigured,
  loadOcppGatewayConfig,
} from "@/utils/ocppUrls";

export function useOcppGatewayConfig() {
  const [ready, setReady] = useState(isOcppGatewayConfigured());

  useEffect(() => {
    let cancelled = false;
    void loadOcppGatewayConfig().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    ready,
    isConfigured: isOcppGatewayConfigured(),
    gatewayRestUrl: getGatewayRestUrl(),
    buildWebSocketUrl: buildOcppWebSocketUrl,
  };
}
