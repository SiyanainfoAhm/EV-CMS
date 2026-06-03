export default function SimulationModeBadge({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`rounded-lg border border-amber-200 bg-amber-50 text-amber-900 ${
        compact ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm"
      }`}
      role="status"
    >
      <p className="font-semibold flex items-center gap-2">
        <i className="ri-cpu-line"></i>
        Simulation Mode
      </p>
      {!compact && (
        <p className="mt-1 text-amber-800/90 leading-relaxed">
          Physical OCPP chargers are not connected. Data is generated through an OCPP-ready simulation. The same
          workflow will work with real chargers when the gateway is connected.
        </p>
      )}
    </div>
  );
}
