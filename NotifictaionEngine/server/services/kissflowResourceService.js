const { sequelize, Application, KissflowResource, KissflowField } = require('../models');

async function ensureKissflowSchema() {
  const qi = sequelize.getQueryInterface();
  try {
    const appDesc = await qi.describeTable('applications');
    if (!appDesc.external_id) {
      await qi.addColumn('applications', 'external_id', {
        type: require('sequelize').STRING(128),
        allowNull: true,
        unique: true,
      });
      console.log('Added applications.external_id');
    }
  } catch (e) {
    console.warn('applications.external_id check:', e.message || e);
  }

  await KissflowResource.sync();
  await KissflowField.sync();
}

async function upsertApplicationFromClient(payload) {
  const externalId = String(payload.external_app_id || '').trim();
  if (!externalId) throw new Error('external_app_id required');

  const defaults = {
    name: payload.application_name || payload.name || 'Kissflow App',
    account_id: payload.account_id,
    app_id: payload.kissflow_app_id || payload.app_id || null,
    subdomain: payload.subdomain || 'subdomain',
    region: payload.region || 'com',
    environment: payload.environment || 'Development',
    process_ids: JSON.stringify(payload.process_ids || []),
    status: 'Active',
  };

  let row = await Application.findOne({ where: { external_id: externalId } });
  if (row) {
    await row.update({
      name: defaults.name,
      account_id: defaults.account_id || row.account_id,
      app_id: defaults.app_id ?? row.app_id,
      subdomain: defaults.subdomain || row.subdomain,
      region: defaults.region || row.region,
      environment: defaults.environment || row.environment,
      last_sync_at: new Date(),
    });
  } else {
    row = await Application.create({ ...defaults, external_id: externalId });
  }
  return row;
}

/**
 * Replace field rows for a resource after Kissflow Admin sync.
 */
async function syncResourceFields(payload) {
  const app = await upsertApplicationFromClient(payload);

  const resourceType = ['process', 'board', 'dataform'].includes(payload.resource_type)
    ? payload.resource_type
    : 'process';
  const resourceId = String(payload.resource_id || '').trim();
  if (!resourceId) throw new Error('resource_id required');

  const [resource] = await KissflowResource.findOrCreate({
    where: {
      application_id: app.id,
      resource_type: resourceType,
      resource_id: resourceId,
    },
    defaults: {
      admin_process_id: payload.admin_process_id || resourceId,
      display_name: payload.display_name || resourceId,
      item_count: 0,
    },
  });

  await resource.update({
    admin_process_id: payload.admin_process_id || resource.admin_process_id || resourceId,
    display_name: payload.display_name || resource.display_name || resourceId,
    item_count: Number(payload.item_count) || 0,
    last_sync_at: new Date(),
  });

  const fields = Array.isArray(payload.fields) ? payload.fields : [];
  await KissflowField.destroy({ where: { kissflow_resource_id: resource.id } });

  if (fields.length) {
    await KissflowField.bulkCreate(
      fields.map((f) => ({
        kissflow_resource_id: resource.id,
        field_name: String(f.name || f.field_name || '').slice(0, 191),
        field_label: f.label || f.field_label || null,
        field_type: f.type || f.field_type || null,
        sample_value: f.sample != null ? String(f.sample).slice(0, 2000) : null,
        occurrences: Number(f.occurrences) || 0,
        is_system: Boolean(f.is_system || String(f.name || '').startsWith('_')),
      })).filter((f) => f.field_name),
    );
  }

  await app.update({ last_sync_at: new Date() });

  const count = await KissflowField.count({ where: { kissflow_resource_id: resource.id } });
  return { application: app, resource, fieldCount: count };
}

async function getResourceFields(query) {
  const externalId = String(query.external_app_id || '').trim();
  const resourceId = String(query.resource_id || '').trim();
  const resourceType = query.resource_type || 'process';

  if (!externalId || !resourceId) {
    return { resource: null, fields: [] };
  }

  const app = await Application.findOne({ where: { external_id: externalId } });
  if (!app) return { resource: null, fields: [] };

  const resource = await KissflowResource.findOne({
    where: {
      application_id: app.id,
      resource_type: resourceType,
      resource_id: resourceId,
    },
    include: [{ model: KissflowField, as: 'fields' }],
  });

  if (!resource) return { resource: null, fields: [] };

  const fields = (resource.fields || [])
    .map((f) => ({
      id: f.field_name,
      name: f.field_name,
      label: f.field_label,
      type: f.field_type,
      sample: f.sample_value,
      occurrences: f.occurrences,
      is_system: f.is_system,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { resource, fields };
}

module.exports = {
  ensureKissflowSchema,
  syncResourceFields,
  getResourceFields,
};
