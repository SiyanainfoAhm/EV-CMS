/** Simulation UI/runtime — opt-in only (set VITE_ENABLE_SIMULATION=true to enable). */
export function isSimulationEnabled(): boolean {
  return import.meta.env.VITE_ENABLE_SIMULATION === "true";
}
