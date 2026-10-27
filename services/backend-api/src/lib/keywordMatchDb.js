'use strict';

const PROJECT = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'master-diorama-489103-u2';
const DATASET = 'itsm_keywords';

const TABLE_NOTES = {
  keywords: 'Phrases the matcher searches for. One row per sub-type. Phrases are separated by commas.',
  approval_matrix: 'Kissflow Live Approval Matrix copy. Category, sub-type, criticality, TAT, and keywords.',
  email_learning_log: 'One row for each match. Stores the message, the cleaned text, and the sub-type that was returned.',
  sub_type_embeddings: 'Vector index used when no keyword phrase hits. Rebuilt from the approval matrix.',
  pending_keywords: 'Phrases mined from recent tickets. They wait for a person to verify them and do not change the master by themselves.',
  learning_audit: 'Sync and learning events, including Kissflow writes from path 3.',
  ml_taxonomy: 'Uploaded category / sub-category / type rows kept for later learning. They do not change a live match.',
};

function rowsFrom(data) {
  const fields = (data?.schema?.fields || []).map((field) => field.name);
  return (data?.rows || []).map((row) => {
    const out = {};
    (row.f || []).forEach((cell, index) => {
      out[fields[index]] = cell?.v == null ? '' : String(cell.v);
    });
    return out;
  });
}

async function runQuery(sql) {
  const { GoogleAuth } = require('google-auth-library');
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/bigquery'] });
  const client = await auth.getClient();
  const res = await client.request({
    url: `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT}/queries`,
    method: 'POST',
    data: {
      query: sql,
      useLegacySql: false,
      timeoutMs: 25000,
      maxResults: 1000,
    },
  });
  if (res.data?.jobComplete === false) {
    const err = new Error('BigQuery query did not finish');
    err.status = 504;
    throw err;
  }
  return rowsFrom(res.data);
}

async function loadKeywordMatchDatabase() {
  const [columns, counts, keywords, matrix, outcomes] = await Promise.all([
    runQuery(`
      SELECT table_name, column_name, data_type
      FROM \`${PROJECT}.${DATASET}.INFORMATION_SCHEMA.COLUMNS\`
      ORDER BY table_name, ordinal_position
    `),
    runQuery(`
      SELECT table_id AS table_name, row_count
      FROM \`${PROJECT}.${DATASET}.__TABLES__\`
      ORDER BY table_id
    `),
    runQuery(`
      SELECT sub_type, keywords
      FROM \`${PROJECT}.${DATASET}.keywords\`
      WHERE sub_type IS NOT NULL
      ORDER BY sub_type
      LIMIT 500
    `),
    runQuery(`
      SELECT entity, category, sub_category, type, sub_type, criticality,
             CAST(turnaround_time_tat AS STRING) AS turnaround_time_tat,
             CAST(closure_time AS STRING) AS closure_time,
             keywords, source
      FROM \`${PROJECT}.${DATASET}.approval_matrix\`
      ORDER BY entity, category, sub_type
      LIMIT 400
    `),
    runQuery(`
      SELECT IFNULL(predicted_source, '') AS predicted_source,
             IFNULL(predicted_status, '') AS predicted_status,
             CAST(COUNT(*) AS STRING) AS n
      FROM \`${PROJECT}.${DATASET}.email_learning_log\`
      GROUP BY predicted_source, predicted_status
      ORDER BY COUNT(*) DESC
      LIMIT 20
    `),
  ]);

  const byTable = new Map();
  for (const row of columns) {
    const name = row.table_name;
    if (!byTable.has(name)) byTable.set(name, []);
    byTable.get(name).push({ name: row.column_name, type: row.data_type });
  }
  const countByTable = new Map(counts.map((row) => [row.table_name, Number(row.row_count) || 0]));
  const tables = [...byTable.entries()].map(([name, cols]) => ({
    name,
    rowCount: countByTable.get(name) || 0,
    note: TABLE_NOTES[name] || '',
    columns: cols,
  }));

  return {
    project: PROJECT,
    dataset: DATASET,
    location: 'BigQuery',
    kissflowForm: 'Live_Approval_Matrix_A00',
    kissflowApplication: 'IT_Service_Management_A00',
    tables,
    keywords,
    matrix,
    outcomes,
  };
}

module.exports = {
  rowsFrom,
  loadKeywordMatchDatabase,
};
