'use strict';

/**
 * Extra rows for the existing MIS section:
 * who raised the request, who it is pending with, the workflow step, and days pending.
 */

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function workflowStep(value) {
  const text = String(value ?? '').trim();
  if (!text || text === '—' || text === '-') return '';
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return '';
    } catch {
      return '';
    }
  }
  return text;
}

function normName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function cell(value, extra) {
  const align = extra && extra.align ? ` align="${extra.align}"` : '';
  const color = extra && extra.color ? extra.color : '#1a1a1a';
  const weight = extra && extra.bold ? ' font-weight:bold;' : '';
  const inner = extra && extra.bold ? `<b>${escapeHtml(value)}</b>` : escapeHtml(value);
  return `<td style="padding:10px 8px; border-bottom:1px solid #ececea; color:${color} !important;${weight}"${align}>${inner}</td>`;
}

function itemsForUser(name, pendingItems, matchField) {
  const key = normName(name);
  if (!key) return [];
  const exact = [];
  const loose = [];
  for (const item of pendingItems) {
    const other = normName(item[matchField] || item[matchField === 'pending_with' ? 'pendingWith' : 'raisedBy']);
    if (!other) continue;
    if (other === key) exact.push(item);
    else if (other.includes(key) || key.includes(other)) loose.push(item);
  }
  return exact.length ? exact : loose;
}

function itemText(item, snake, camel) {
  return String((item && (item[snake] || item[camel])) || '').trim();
}

function nameCell(name, raisedBy) {
  const raised = String(raisedBy || '').trim();
  const display = raised && raised !== '—' ? raised : name;
  return `<td style="padding:10px 8px; border-bottom:1px solid #ececea; color:#1a1a1a !important;">${escapeHtml(display)}</td>`;
}

function renderRmcMisUserRows(users, pendingItems, today, matchField) {
  const pending = Array.isArray(pendingItems) ? pendingItems : [];
  const field = matchField === 'raised_by' ? 'raised_by' : 'pending_with';
  const list = (Array.isArray(users) ? users : []).filter((user) => {
    const name = String(user.user_name || user.userName || '').trim();
    return name && !/^us[a-z0-9_-]{6,}$/i.test(name);
  });
  if (!list.length) {
    return '<tr style="background-color:#ffffff;" bgcolor="#ffffff"><td colspan="6" style="padding:16px 14px; border-bottom:1px solid #ececea; color:#64748b !important; text-align:center;">No users with pending or completed items in this snapshot.</td></tr>';
  }
  const built = [];
  list.forEach((user) => {
    const name = user.user_name || user.userName || 'Unknown';
    const signed = String(user.last_sign_in || user.lastSignIn || '');
    const signedToday = Boolean(today) && signed.startsWith(today);
    const signin = !signed || signed === 'Never' ? '-' : signed;
    const completedCount = Number(user.completed_count ?? user.completedCount ?? 0) || 0;
    const items = itemsForUser(name, pending, field);
    if (!items.length) {
      built.push({ name, raised: '', step: '—', whom: '—', days: '—', completedCount, signin, signedToday });
      return;
    }
    items.forEach((item) => {
      const step = workflowStep(item.pending_step || item.pendingStep) || '—';
      const whom = itemText(item, 'pending_with', 'pendingWith') || '—';
      const day = Number(item.days_pending ?? item.daysPending);
      built.push({
        name,
        raised: itemText(item, 'raised_by', 'raisedBy'),
        step,
        whom,
        days: Number.isFinite(day) ? String(day) : '—',
        completedCount,
        signin,
        signedToday,
      });
    });
  });
  return built
    .map((row, idx) => {
      const bg = row.signedToday ? '#dcfce7' : idx % 2 === 0 ? '#faf9f7' : '#ffffff';
      return (
        `<tr style="background-color:${bg};" bgcolor="${bg}">` +
        nameCell(row.name, row.raised) +
        cell(row.signin, row.signedToday ? { color: '#166534', bold: true } : null) +
        cell(row.step) +
        cell(row.whom) +
        cell(row.days, { align: 'center' }) +
        cell(String(row.completedCount), { align: 'center', bold: true, color: '#3f8f63' }) +
        '</tr>'
      );
    })
    .join('');
}

function renderRmcMisSection(users, pendingItems, today) {
  const body = renderRmcMisUserRows(users, pendingItems, today, 'raised_by');
  return (
    '<tr><td style="padding:26px 32px 6px 32px; font-size:13.5px; font-weight:bold; color:#1a1a1a !important;" bgcolor="#ffffff">Users with pending or recent activity</td></tr>' +
    '<tr><td style="padding:8px 32px 28px 32px;" bgcolor="#ffffff">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; font-size:12px; border-radius:8px; overflow:hidden;">' +
    '<tr style="background:#14503a;" bgcolor="#14503a">' +
    '<td style="padding:10px 8px; color:#ffffff !important; font-weight:bold;">User</td>' +
    '<td style="padding:10px 8px; color:#ffffff !important; font-weight:bold;">Last Signed In</td>' +
    '<td style="padding:10px 8px; color:#ffffff !important; font-weight:bold;">Pending step</td>' +
    '<td style="padding:10px 8px; color:#ffffff !important; font-weight:bold;">Pending with</td>' +
    '<td style="padding:10px 8px; color:#ffffff !important; font-weight:bold;" align="center">Days</td>' +
    '<td style="padding:10px 8px; color:#ffffff !important; font-weight:bold;" align="center">Completed</td>' +
    '</tr>' +
    body +
    '</table></td></tr>'
  );
}

function renderMisPendingSection(rows) {
  const list = Array.isArray(rows) ? rows.filter((row) => row && (row.raised_by || row.raisedBy)) : [];
  if (!list.length) return '';
  const body = list
    .map((row, idx) => {
      const bg = idx % 2 ? '#ffffff' : '#fffaf2';
      const raised = row.raised_by || row.raisedBy || '—';
      const pendingWith = row.pending_with || row.pendingWith || '—';
      const pendingStep = row.pending_step || row.pendingStep || '—';
      const days = row.days_pending ?? row.daysPending;
      const dayText = days == null || days === '' ? '—' : String(days);
      return `<tr style="background-color:${bg};" bgcolor="${bg}">
<td style="padding:12px 10px; border-bottom:1px solid #ececea; color:#1a1a1a !important;">${escapeHtml(raised)}</td>
<td style="padding:12px 10px; border-bottom:1px solid #ececea; color:#1a1a1a !important;">${escapeHtml(pendingWith)}</td>
<td style="padding:12px 10px; border-bottom:1px solid #ececea; color:#1a1a1a !important;">${escapeHtml(pendingStep)}</td>
<td style="padding:12px 10px; border-bottom:1px solid #ececea; color:#1a1a1a !important;" align="center">${escapeHtml(dayText)}</td>
</tr>`;
    })
    .join('');
  return `<tr><td style="padding:8px 32px 6px 32px; font-size:13.5px; font-weight:bold; color:#1a1a1a !important;" bgcolor="#ffffff">Pending requests</td></tr>
<tr><td style="padding:8px 32px 20px 32px;" bgcolor="#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; font-size:12.5px; border-radius:8px; overflow:hidden;">
<tr style="background:#14503a;" bgcolor="#14503a">
<td style="padding:12px 10px; color:#ffffff !important; font-weight:bold;">Raised by</td>
<td style="padding:12px 10px; color:#ffffff !important; font-weight:bold;">Pending with</td>
<td style="padding:12px 10px; color:#ffffff !important; font-weight:bold;">Pending at</td>
<td style="padding:12px 10px; color:#ffffff !important; font-weight:bold;" align="center">Days pending</td>
</tr>
${body}
</table></td></tr>`;
}

function readRows(raw) {
  if (!raw || !String(raw).trim()) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

if (require.main === module) {
  const raw = process.env.MIS_PENDING_JSON || '[]';
  try {
    const pending = readRows(raw);
    if (process.env.USERS_JSON) {
      const users = readRows(process.env.USERS_JSON);
      const today = process.env.TODAY_IST || '';
      if (process.env.MIS_TABLE_MODE === 'section') {
        process.stdout.write(renderRmcMisSection(users, pending, today));
      } else {
        process.stdout.write(renderRmcMisUserRows(users, pending, today, process.env.MIS_MATCH || 'pending_with'));
      }
    } else {
      process.stdout.write(renderMisPendingSection(pending));
    }
  } catch (err) {
    process.stderr.write(String(err && err.message ? err.message : err));
    process.exit(1);
  }
}

module.exports = {
  renderMisPendingSection,
  renderRmcMisUserRows,
  renderRmcMisSection,
  workflowStep,
};
