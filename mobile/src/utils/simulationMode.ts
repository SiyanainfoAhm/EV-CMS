/** Simulation UI — opt-in only (set EXPO_PUBLIC_ENABLE_SIMULATION=true to enable). */
export function isSimulationEnabled(): boolean {
  return process.env.EXPO_PUBLIC_ENABLE_SIMULATION === "true";
}
