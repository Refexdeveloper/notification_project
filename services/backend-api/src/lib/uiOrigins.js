'use strict';

function allowedUiOrigins() {
  const extra = String(process.env.ADMIN_UI_ORIGINS || '')
    .split(',')
    .map((value) => value.trim().replace(/\/$/, ''))
    .filter(Boolean);
  return [
    'https://refex-admin-ui-dhwffeu7pq-el.a.run.app',
    'https://refex-admin-ui-645830234926.asia-south1.run.app',
    'http://localhost:5173',
    'http://localhost:4173',
    ...extra,
  ];
}

function resolveUiOrigin(value, fallback = 'https://refex-admin-ui-dhwffeu7pq-el.a.run.app') {
  const requested = String(value || '')
    .trim()
    .replace(/\/$/, '');
  if (allowedUiOrigins().includes(requested)) return requested;
  return fallback;
}

module.exports = { allowedUiOrigins, resolveUiOrigin };
