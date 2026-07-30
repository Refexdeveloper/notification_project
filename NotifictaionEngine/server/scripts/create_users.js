/**
 * Seed demo operators into notification_engine.users via the API.
 * Usage: node scripts/create_users.js
 */
require('dotenv').config();

const API = process.env.API_URL || 'http://localhost:4000/api';

async function req(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `HTTP ${res.status} on ${path}`);
  }
  return data;
}

async function main() {
  const login = await req('/auth/login', {
    method: 'POST',
    body: {
      email: 'admin@notificationengine.com',
      password: 'password123',
    },
  });
  const token = login.accessToken;
  const roles = await req('/roles', { token });
  const byName = Object.fromEntries(roles.map((r) => [r.name, r.id]));

  const toCreate = [
    {
      name: 'Ops Operator',
      email: 'operator@notificationengine.com',
      password: 'operator123',
      role_id: byName.Operator,
    },
    {
      name: 'Report Viewer',
      email: 'viewer@notificationengine.com',
      password: 'viewer123',
      role_id: byName.Viewer,
    },
    {
      name: 'Raghul JE',
      email: 'raghul@notificationengine.com',
      password: 'raghul123',
      role_id: byName.Admin,
    },
  ];

  for (const user of toCreate) {
    try {
      const created = await req('/users', { method: 'POST', token, body: user });
      console.log('CREATED', created.id, created.email, created.role?.name);
    } catch (err) {
      console.log('SKIP/FAIL', user.email, err.message);
    }
  }

  const all = await req('/users', { token });
  console.log('\nUsers in DB:');
  for (const u of all) {
    console.log(`- #${u.id} ${u.name} <${u.email}> [${u.role?.name}] active=${u.is_active}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
