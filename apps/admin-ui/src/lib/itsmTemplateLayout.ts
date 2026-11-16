/** Ensure ITSM templates include Source placeholders so Preview can render them. */

export function ensureItsmSourcePlaceholders(html: string): { html: string; changed: boolean } {
  let out = String(html || '');
  let changed = false;

  if (out && !out.includes('{{SourceBreakdownHtml}}')) {
    const needles = ["Today's Ticket Activity", 'Today\u2019s Ticket Activity', 'Users with open or recent activity'];
    let inserted = false;
    for (const needle of needles) {
      const idx = out.indexOf(needle);
      if (idx < 0) continue;
      const trStart = out.lastIndexOf('<tr>', idx);
      if (trStart < 0) continue;
      out = `${out.slice(0, trStart)}{{SourceBreakdownHtml}}\n${out.slice(trStart)}`;
      inserted = true;
      changed = true;
      break;
    }
    if (!inserted && out.includes('</body>')) {
      out = out.replace('</body>', '{{SourceBreakdownHtml}}\n</body>');
      changed = true;
    }
  }

  // Source chips do not belong inside the Opened Today KPI card.
  if (out.includes('{{OpenedTodaySourceHtml}}')) {
    out = out.split('{{OpenedTodaySourceHtml}}').join('');
    changed = true;
  }

  return { html: out, changed };
}

export function preferExtrovisStarter(templateName: string): boolean {
  return /extrovis/i.test(String(templateName || ''));
}

/** Extrovis-process entity layouts (shared process, separate schedules). */
export function resolveItsmEntityStarterId(templateName: string): string {
  const name = String(templateName || '');
  if (/kavis/i.test(name)) return 'itsm-kavispharma';
  if (/modepro/i.test(name)) return 'itsm-modepro';
  if (/extrovis/i.test(name)) return 'itsm-extrovis';
  return 'itsm';
}

export function itsmEntityStarterLabel(starterId: string): string {
  if (starterId === 'itsm-kavispharma') return 'Kavis Pharma';
  if (starterId === 'itsm-modepro') return 'ModePro';
  if (starterId === 'itsm-extrovis') return 'Extrovis';
  return 'Refex ITSM';
}
