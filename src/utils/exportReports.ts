export function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]): void {
  const escape = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function printPdfReport(title: string, sections: { heading: string; lines: string[] }[]): void {
  const html = `<!DOCTYPE html><html><head><title>${title}</title>
    <style>
      body { font-family: system-ui, sans-serif; padding: 24px; color: #111; }
      h1 { font-size: 18px; margin-bottom: 4px; }
      h2 { font-size: 14px; margin: 16px 0 8px; color: #374151; }
      p, li { font-size: 12px; line-height: 1.5; }
      .meta { color: #6b7280; font-size: 11px; margin-bottom: 16px; }
    </style></head><body>
    <h1>${title}</h1>
    <p class="meta">Generated ${new Date().toLocaleString("en-IN")} · DFCCIL EV CMS</p>
    ${sections
      .map(
        (s) =>
          `<h2>${s.heading}</h2><ul>${s.lines.map((l) => `<li>${l}</li>`).join("")}</ul>`
      )
      .join("")}
    </body></html>`;
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
}
