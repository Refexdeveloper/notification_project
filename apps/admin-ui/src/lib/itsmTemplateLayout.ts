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
