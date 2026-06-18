import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import * as searchService from "@/services/searchService";

export default function GlobalSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<searchService.GlobalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounced = useDebouncedValue(query, 200);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounced.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    searchService
      .globalSearch(debounced)
      .then(setResults)
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, [debounced]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const iconFor = (type: searchService.GlobalSearchResult["type"]) => {
    if (type === "charger") return "ri-ev-station-line";
    if (type === "session") return "ri-battery-charge-line";
    return "ri-user-line";
  };

  return (
    <div ref={containerRef} className="relative">
      <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm"></i>
      <input
        type="text"
        placeholder="Search chargers, users, sessions..."
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className="pl-9 pr-4 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-sm w-72 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
      />
      {open && query.trim().length >= 2 && (
        <div className="absolute top-full left-0 mt-1 w-96 max-h-80 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg z-50">
          {loading ? (
            <p className="px-4 py-3 text-xs text-gray-400">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-3 text-xs text-gray-400">No results for &quot;{query}&quot;</p>
          ) : (
            results.map((r) => (
              <button
                key={`${r.type}-${r.id}`}
                type="button"
                onClick={() => {
                  navigate(r.path);
                  setOpen(false);
                  setQuery("");
                }}
                className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-start gap-2 border-b border-gray-50 last:border-0"
              >
                <i className={`${iconFor(r.type)} text-emerald-600 mt-0.5`}></i>
                <span>
                  <span className="block text-sm font-medium text-gray-900">{r.title}</span>
                  <span className="block text-xs text-gray-500">{r.subtitle}</span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
