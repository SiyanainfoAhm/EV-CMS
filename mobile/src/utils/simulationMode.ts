/** Simulation UI: on in dev; off in production builds unless EXPO_PUBLIC_ENABLE_SIMULATION=true */
export function isSimulationEnabled(): boolean {
  if (!__DEV__) {
    return process.env.EXPO_PUBLIC_ENABLE_SIMULATION === "true";
  }
  return process.env.EXPO_PUBLIC_ENABLE_SIMULATION !== "false";
}
