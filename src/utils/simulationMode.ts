/** Simulation UI/runtime: on in dev by default; off in production unless VITE_ENABLE_SIMULATION=true */
export function isSimulationEnabled(): boolean {
  if (import.meta.env.PROD) {
    return import.meta.env.VITE_ENABLE_SIMULATION === "true";
  }
  return import.meta.env.VITE_ENABLE_SIMULATION !== "false";
}
