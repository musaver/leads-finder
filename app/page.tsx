"use client";

import { useState } from "react";
import type { Lead, ScanEvent } from "@/lib/types";

type AllLead = { lead: Lead; isLead: boolean };

export default function Home() {
  const [query, setQuery] = useState("dentists");
  const [location, setLocation] = useState("Chicago, IL");
  const [maxResults, setMaxResults] = useState(60);
  const [maxScore, setMaxScore] = useState(4);
  const [requireEmail, setRequireEmail] = useState(false);
  const [apiKey, setApiKey] = useState("");

  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState("");
  const [allResults, setAllResults] = useState<AllLead[]>([]);
  const [showAll, setShowAll] = useState(false);

  const leads = allResults.filter((r) => r.isLead).map((r) => r.lead);
  const visible = showAll ? allResults.map((r) => r.lead) : leads;

  async function startScan() {
    setScanning(true);
    setAllResults([]);
    setError("");
    setStatus("");
    setProgress({ done: 0, total: 0 });

    try {
      const resp = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          location,
          maxResults,
          maxScore,
          requireEmail,
          apiKey: apiKey || undefined,
        }),
      });

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({ error: resp.statusText }));
        throw new Error(errBody.error || `Request failed: ${resp.status}`);
      }
      if (!resp.body) throw new Error("No response body");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          let event: ScanEvent;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }

          if (event.type === "status") {
            setStatus(event.message);
            if (event.total) setProgress({ done: 0, total: event.total });
          } else if (event.type === "lead") {
            setProgress({ done: event.index, total: event.total });
            setAllResults((prev) => [...prev, { lead: event.lead, isLead: event.isLead }]);
          } else if (event.type === "error") {
            setError(event.message);
          } else if (event.type === "done") {
            setStatus("Scan complete.");
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  }

  function exportCsv() {
    if (leads.length === 0) return;
    const keys = Object.keys(leads[0]) as (keyof Lead)[];
    const escape = (v: unknown) => {
      const s = v == null ? "" : Array.isArray(v) ? v.join("; ") : String(v);
      return `"${s.replace(/"/g, '""')}"`;
    };
    const rows = [keys.join(",")];
    for (const lead of leads) rows.push(keys.map((k) => escape(lead[k])).join(","));
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-${query.replace(/\s+/g, "_")}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-900">
      <div className="max-w-7xl mx-auto px-6 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Lead Finder</h1>
          <p className="text-zinc-600 mt-1">
            Find businesses with no website or low-quality websites. Powered by Google Places.
          </p>
        </header>

        {/* Form */}
        <section className="bg-white border border-zinc-200 rounded-lg p-6 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Business type / query">
              <input
                className="input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. dentists, plumbers, salons"
                disabled={scanning}
              />
            </Field>
            <Field label="Location">
              <input
                className="input"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Chicago, IL"
                disabled={scanning}
              />
            </Field>
            <Field label="Max results (cap ~60)">
              <input
                type="number"
                min={1}
                max={60}
                className="input"
                value={maxResults}
                onChange={(e) => setMaxResults(Number(e.target.value))}
                disabled={scanning}
              />
            </Field>
            <Field label="Max quality score (0-9). Lower = stricter">
              <input
                type="number"
                min={0}
                max={9}
                className="input"
                value={maxScore}
                onChange={(e) => setMaxScore(Number(e.target.value))}
                disabled={scanning}
              />
            </Field>
            <Field label="Google Maps API key (optional, falls back to env)" full>
              <input
                type="password"
                className="input"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Leave blank to use GOOGLE_MAPS_API_KEY"
                disabled={scanning}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-zinc-700 md:col-span-2">
              <input
                type="checkbox"
                checked={requireEmail}
                onChange={(e) => setRequireEmail(e.target.checked)}
                disabled={scanning}
              />
              Only fetch leads with an email
              <span className="text-xs text-zinc-500">
                (skips businesses where no email could be found, incl. those without a website)
              </span>
            </label>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={startScan}
              disabled={scanning || !query || !location}
              className="btn-primary"
            >
              {scanning ? "Scanning..." : "Start scan"}
            </button>
            {leads.length > 0 && (
              <button onClick={exportCsv} className="btn-secondary">
                Export {leads.length} leads as CSV
              </button>
            )}
          </div>
        </section>

        {/* Progress */}
        {(scanning || status) && (
          <section className="mt-6">
            <div className="text-sm text-zinc-700 mb-2">{status}</div>
            {progress.total > 0 && (
              <div className="w-full h-2 bg-zinc-200 rounded overflow-hidden">
                <div
                  className="h-full bg-zinc-900 transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
            <div className="text-xs text-zinc-500 mt-1">
              {progress.done}/{progress.total} processed · {leads.length} leads matched
            </div>
          </section>
        )}

        {/* Error */}
        {error && (
          <section className="mt-6 bg-red-50 border border-red-200 text-red-800 rounded-md px-4 py-3 text-sm">
            {error}
          </section>
        )}

        {/* Results */}
        {allResults.length > 0 && (
          <section className="mt-8">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">
                {showAll ? `All results (${allResults.length})` : `Leads (${leads.length})`}
              </h2>
              <label className="flex items-center gap-2 text-sm text-zinc-600">
                <input
                  type="checkbox"
                  checked={showAll}
                  onChange={(e) => setShowAll(e.target.checked)}
                />
                Show all (incl. high-quality sites)
              </label>
            </div>

            <div className="overflow-x-auto bg-white border border-zinc-200 rounded-lg shadow-sm">
              <table className="min-w-full text-sm">
                <thead className="bg-zinc-50 text-zinc-600 text-left">
                  <tr>
                    <Th>Name</Th>
                    <Th>Phone</Th>
                    <Th>Email</Th>
                    <Th>Website</Th>
                    <Th>Score</Th>
                    <Th>Status</Th>
                    <Th>Reasons</Th>
                    <Th>Rating</Th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((lead) => (
                    <tr key={lead.placeId} className="border-t border-zinc-100 align-top">
                      <Td>
                        <div className="font-medium">{lead.name}</div>
                        <div className="text-xs text-zinc-500">{lead.address}</div>
                      </Td>
                      <Td>{lead.phone || "—"}</Td>
                      <Td>
                        {lead.emails.length > 0 ? (
                          <div className="flex flex-col gap-0.5">
                            {lead.emails.map((email) => (
                              <a
                                key={email}
                                href={`mailto:${email}`}
                                className="text-blue-600 hover:underline break-all"
                              >
                                {email}
                              </a>
                            ))}
                          </div>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </Td>
                      <Td>
                        {lead.website ? (
                          <a
                            href={lead.website}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 hover:underline break-all"
                          >
                            {lead.website.replace(/^https?:\/\//, "").slice(0, 40)}
                          </a>
                        ) : (
                          <span className="text-zinc-400">none</span>
                        )}
                      </Td>
                      <Td>
                        {lead.hasWebsite ? (
                          <ScoreBadge score={lead.qualityScore} />
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </Td>
                      <Td>{lead.siteStatus}</Td>
                      <Td className="text-xs text-zinc-600 max-w-xs">
                        {lead.qualityReasons || "—"}
                      </Td>
                      <Td>
                        {lead.rating != null ? (
                          <span>
                            {lead.rating.toFixed(1)}{" "}
                            <span className="text-zinc-400 text-xs">
                              ({lead.reviewCount})
                            </span>
                          </span>
                        ) : "—"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      {/* Tailwind utility classes used as @apply-style helpers */}
      <style jsx>{`
        :global(.input) {
          width: 100%;
          padding: 0.5rem 0.75rem;
          border: 1px solid rgb(228 228 231);
          border-radius: 0.375rem;
          font-size: 0.875rem;
          background: white;
          outline: none;
        }
        :global(.input:focus) {
          border-color: rgb(82 82 91);
          box-shadow: 0 0 0 3px rgba(82, 82, 91, 0.1);
        }
        :global(.input:disabled) { background: rgb(244 244 245); cursor: not-allowed; }
        :global(.btn-primary) {
          background: rgb(24 24 27);
          color: white;
          padding: 0.5rem 1rem;
          border-radius: 0.375rem;
          font-size: 0.875rem;
          font-weight: 500;
        }
        :global(.btn-primary:disabled) { opacity: 0.5; cursor: not-allowed; }
        :global(.btn-secondary) {
          background: white;
          color: rgb(24 24 27);
          padding: 0.5rem 1rem;
          border: 1px solid rgb(228 228 231);
          border-radius: 0.375rem;
          font-size: 0.875rem;
          font-weight: 500;
        }
      `}</style>
    </main>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={full ? "md:col-span-2" : ""}>
      <span className="block text-sm font-medium text-zinc-700 mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2.5 font-medium uppercase text-xs tracking-wide">{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 ${className}`}>{children}</td>;
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score <= 3 ? "bg-red-100 text-red-800" :
    score <= 5 ? "bg-amber-100 text-amber-800" :
    "bg-emerald-100 text-emerald-800";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {score}/9
    </span>
  );
}
