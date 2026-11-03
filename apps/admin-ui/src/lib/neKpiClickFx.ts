/** Visual only. The card still calls its existing onClick immediately. */

export type NeKpiClickKind =
  | 'all'
  | 'pending'
  | 'approved'
  | 'overdue'
  | 'reject'
  | 'adoption'
  | 'users'
  | 'today'
  | 'money'
  | 'tap';

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const CONFETTI_COLORS = ['#17a2b4', '#34d9a0', '#f39a1f', '#5b8cff', '#ff7b8a', '#5fe0e6', '#ffd34d'];

function confetti(el: HTMLElement, pieces = 48) {
  if (reducedMotion()) return;
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  for (let i = 0; i < pieces; i += 1) {
    const c = document.createElement('i');
    c.className = 'fx-confetti';
    c.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    if (i % 3 === 0) c.style.borderRadius = '50%';
    document.body.appendChild(c);
    const a = Math.random() * Math.PI * 2;
    const v = 120 + Math.random() * 220;
    const dx = Math.cos(a) * v;
    const dy = Math.sin(a) * v - 160;
    const rot = Math.random() * 720 - 360;
    c.animate(
      [
        { transform: `translate(${cx}px,${cy}px) rotate(0)`, opacity: 1 },
        { transform: `translate(${cx + dx}px,${cy + dy}px) rotate(${rot / 2}deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${cx + dx * 1.2}px,${cy + dy + 360}px) rotate(${rot}deg)`, opacity: 0 },
      ],
      { duration: 1300 + Math.random() * 700, easing: 'cubic-bezier(.2,.7,.4,1)' },
    ).onfinish = () => c.remove();
  }
}

function overlayOn(el: HTMLElement, className: string, html: string, ms: number) {
  const r = el.getBoundingClientRect();
  const o = document.createElement('div');
  o.className = `fx-ov ${className}`;
  o.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
  o.innerHTML = html;
  document.body.appendChild(o);
  window.setTimeout(() => o.remove(), ms);
}

function pulseClass(el: HTMLElement, cls: string, ms: number) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  window.setTimeout(() => el.classList.remove(cls), ms);
}

const DOC_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2.5H7A2.5 2.5 0 0 0 4.5 5v14A2.5 2.5 0 0 0 7 21.5h10a2.5 2.5 0 0 0 2.5-2.5V8z"/><path d="M14 2.5V8h5.5M8.5 13h7M8.5 17h5"/></svg>';

function allFx(el: HTMLElement) {
  if (reducedMotion()) return;
  pulseClass(el, 'fx-bounce', 700);
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const n = 9;
  for (let i = 0; i < n; i += 1) {
    const d = document.createElement('div');
    d.className = 'fx-doc';
    d.innerHTML = DOC_SVG;
    document.body.appendChild(d);
    const ang = (-150 + (120 / (n - 1)) * i) * (Math.PI / 180);
    const dist = 120 + (i % 2) * 40;
    const x = Math.cos(ang) * dist;
    const y = Math.sin(ang) * dist;
    const rot = (i - (n - 1) / 2) * 12;
    d.animate(
      [
        { transform: `translate(${cx}px,${cy}px) translate(-50%,-50%) scale(.3) rotate(0)`, opacity: 0 },
        { transform: `translate(${cx + x}px,${cy + y}px) translate(-50%,-50%) scale(1) rotate(${rot}deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${cx + x * 1.05}px,${cy + y * 1.05}px) translate(-50%,-50%) scale(1) rotate(${rot}deg)`, opacity: 1, offset: 0.7 },
        { transform: `translate(${cx}px,${cy}px) translate(-50%,-50%) scale(.2) rotate(${rot * 2}deg)`, opacity: 0 },
      ],
      { duration: 1400, delay: i * 35, easing: 'cubic-bezier(.3,1.3,.5,1)', fill: 'backwards' },
    ).onfinish = () => d.remove();
  }
  overlayOn(el, 'fx-all', '<div class="fx-all-glow"></div>', 1300);
}

function pendingFx(el: HTMLElement) {
  if (reducedMotion()) return;
  pulseClass(el, 'fx-breathe', 1400);
  const ticks = Array.from({ length: 12 }, (_, i) => `<line class="tick" x1="24" y1="6.5" x2="24" y2="${i % 3 === 0 ? 10 : 8.5}" transform="rotate(${i * 30} 24 24)"/>`).join('');
  overlayOn(
    el,
    'fx-pending',
    `<i class="fx-ring r1"></i><i class="fx-ring r2"></i><i class="fx-ring r3"></i>
     <div class="fx-clock">
       <svg viewBox="0 0 48 48">
         <circle cx="24" cy="24" r="20" class="face"/>
         ${ticks}
         <line class="hand h" x1="24" y1="24" x2="24" y2="14"/>
         <line class="hand m" x1="24" y1="24" x2="24" y2="9"/>
         <circle cx="24" cy="24" r="2.2" class="pin"/>
       </svg>
     </div>`,
    1600,
  );
}

function overdueFx(el: HTMLElement) {
  if (reducedMotion()) return;
  pulseClass(el, 'fx-reject-shake', 700);
  overlayOn(
    el,
    'fx-overdue',
    `<i class="fx-wave v1"></i><i class="fx-wave v2"></i><i class="fx-wave v3"></i>
     <div class="fx-alarm">
       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.5 1.5M4 5l3-2.5M20 5l-3-2.5M7 20l-1.5 1.8M17 20l1.5 1.8"/></svg>
     </div>`,
    1500,
  );
}

function adoptionFx(el: HTMLElement) {
  if (reducedMotion()) return;
  pulseClass(el, 'fx-breathe', 900);
  overlayOn(
    el,
    'fx-adoption',
    `<svg viewBox="0 0 64 64" class="fx-ring" aria-hidden>
       <circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" stroke-width="4" opacity="0.25"/>
       <circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" stroke-width="4" stroke-dasharray="96 140" stroke-linecap="round"/>
     </svg>`,
    1100,
  );
}

function usersFx(el: HTMLElement) {
  if (reducedMotion()) return;
  pulseClass(el, 'fx-bounce', 700);
  overlayOn(
    el,
    'fx-users',
    `<span class="fx-person p1"></span><span class="fx-person p2"></span><span class="fx-person p3"></span>`,
    1000,
  );
}

function todayFx(el: HTMLElement) {
  if (reducedMotion()) return;
  pulseClass(el, 'fx-breathe', 900);
  overlayOn(
    el,
    'fx-today',
    `<svg viewBox="0 0 24 24" class="fx-cal" fill="none" stroke="currentColor" stroke-width="2" aria-hidden>
       <rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>
     </svg>`,
    1000,
  );
}

function moneyFx(el: HTMLElement) {
  if (reducedMotion()) return;
  pulseClass(el, 'fx-bounce', 700);
  overlayOn(el, 'fx-money', '<span class="fx-coin">₹</span>', 1000);
}

function rejectFx(el: HTMLElement) {
  if (reducedMotion()) return;
  pulseClass(el, 'fx-reject-shake', 700);
}

function tapFx(el: HTMLElement) {
  if (reducedMotion()) return;
  pulseClass(el, 'fx-bounce', 500);
}

const FX: Record<NeKpiClickKind, (el: HTMLElement) => void> = {
  all: allFx,
  pending: pendingFx,
  approved: confetti,
  overdue: overdueFx,
  reject: rejectFx,
  adoption: adoptionFx,
  users: usersFx,
  today: todayFx,
  money: moneyFx,
  tap: tapFx,
};

/**
 * Picks a click effect from the card title.
 * Does not change which filter the card runs.
 */
export function neKpiClickKind(label: string): NeKpiClickKind {
  const text = String(label || '').toLowerCase();
  if (/sla|breach|overdue/.test(text)) return 'overdue';
  if (/reject/.test(text)) return 'reject';
  if (/adoption|overall/.test(text)) return 'adoption';
  if (/user|signed|sign-in|signin/.test(text)) return 'users';
  if (/today/.test(text)) return 'today';
  if (/closed|complete|approved|resolved/.test(text)) return 'approved';
  if (/open|pending|progress|pickup|queue/.test(text)) return 'pending';
  if (/book|claim|submit|amount|fare/.test(text)) return 'money';
  if (/^total\b|all item|all ticket/.test(text)) return 'all';
  return 'tap';
}

export function playNeKpiClickFx(kind: NeKpiClickKind, el: HTMLElement | null) {
  if (!el) return;
  FX[kind]?.(el);
}
