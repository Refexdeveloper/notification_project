'use strict';

const { getPool, isDatabaseConfigured } = require('./db');
const { suggestStarterId, STARTER_CATALOG, getStarterHtml } = require('./reportStarters');
const { normalizeReportTemplateHtml } = require('./templatePipelineSync');

const LOGO_URL = 'https://storage.googleapis.com/aasik-refex-report-assets/refexone-logo.png';
const DIVIDER_URL =
  'https://storage.googleapis.com/aasik-refex-report-assets/refex-shimmer-divider-green.gif';

function isAiConfigured() {
  return Boolean(
    process.env.GEMINI_API_KEY
      || process.env.GOOGLE_API_KEY
      || process.env.GCP_PROJECT
      || process.env.GOOGLE_CLOUD_PROJECT
      || process.env.GCLOUD_PROJECT,
  );
}

function resolveProjectId() {
  return (
    process.env.GCP_PROJECT
    || process.env.GOOGLE_CLOUD_PROJECT
    || process.env.GCLOUD_PROJECT
    || ''
  );
}

function resolveModel() {
  return process.env.GEMINI_MODEL || process.env.VERTEX_GEMINI_MODEL || 'gemini-2.5-flash';
}

function resolveVertexLocation() {
  return process.env.VERTEX_LOCATION || process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
}

async function fetchMetadataAccessToken() {
  const res = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: AbortSignal.timeout(3000),
    },
  );
  if (!res.ok) {
    throw new Error(`Metadata token failed (${res.status})`);
  }
  const data = await res.json();
  if (!data.access_token) {
    throw new Error('Metadata token response missing access_token');
  }
  return data.access_token;
}

async function loadAppAiContext(environment, applicationId) {
  if (!isDatabaseConfigured()) {
    return {
      application_name: applicationId,
      process_ids: [],
      process_names: [],
      field_names: [],
    };
  }

  const { rows } = await getPool().query(
    `SELECT
       a.application_name,
       COALESCE(
         (
           SELECT json_agg(
             json_build_object(
               'process_id', p.process_id,
               'process_name', p.process_name,
               'field_names', COALESCE(
                 (
                   SELECT json_agg(DISTINCT fld->>'name')
                   FROM jsonb_array_elements(
                     COALESCE(p.source_payload->'field_discovery'->'fields', '[]'::jsonb)
                   ) AS fld
                   WHERE COALESCE(fld->>'name', '') <> ''
                 ),
                 '[]'::json
               )
             )
             ORDER BY p.process_name
           )
           FROM engagement_reporting.process p
           WHERE p.environment = a.environment
             AND p.application_id = a.application_id
             AND p.is_current = true
         ),
         '[]'::json
       ) AS processes
     FROM engagement_reporting.application a
     WHERE a.environment = $1
       AND a.application_id = $2
       AND a.is_current = true
     LIMIT 1`,
    [environment, applicationId],
  );

  const row = rows[0];
  const processes = Array.isArray(row?.processes) ? row.processes : [];
  const fieldNames = [
    ...new Set(
      processes.flatMap((p) => (Array.isArray(p.field_names) ? p.field_names : [])).filter(Boolean),
    ),
  ];

  return {
    application_name: String(row?.application_name || applicationId),
    process_ids: processes.map((p) => p.process_id).filter(Boolean),
    process_names: processes.map((p) => p.process_name).filter(Boolean),
    field_names: fieldNames.slice(0, 80),
  };
}

function allowedPlaceholdersForStarter(starterId) {
  const item = STARTER_CATALOG.find((row) => row.id === starterId);
  const base = item?.placeholders || [
    'ReportTitle',
    'ReportDate',
    'TotalTickets',
    'OpenTickets',
    'ClosedTickets',
    'UserTableHtml',
    'ReportBody',
    'CompanyName',
  ];
  return [...new Set([...base, 'RecipientName', 'CompanyName'])];
}

function buildSystemPrompt({ appName, starterId, placeholders, fieldNames }) {
  return `You are an expert email HTML designer for Refex Notification Engine engagement reports.

Return ONLY a complete HTML email document (start with <!DOCTYPE html>). No markdown, no code fences, no commentary.

Hard rules:
1. Email-safe only: nested <table role="presentation"> layout, inline CSS, bgcolor attributes. No JavaScript, no external CSS files, no <style> blocks that rely on classes for layout-critical styles.
2. Width about 680px, light background (#eef0f2), white card, Refex-friendly greens (#0f6b4c / #0f766e). Avoid purple themes.
3. Include the Refex logo image: ${LOGO_URL}
4. Optional green divider image: ${DIVIDER_URL}
5. Use ONLY these Mustache placeholders (exact spelling, double curly braces): ${placeholders.map((p) => `{{${p}}}`).join(', ')}
6. Do NOT invent other {{placeholders}}. Pipeline HTML blocks like {{UserTableHtml}}, {{LeadTableHtml}}, {{SourceBreakdownHtml}} must appear as the placeholder token alone (the pipeline injects full table rows/HTML).
7. Include {{ReportTitle}} and {{ReportDate}} in the header area.
8. Prefer KPI metric cards + a details/table section matching starter "${starterId}" for application "${appName}".
9. Keep labels human-readable; values must be placeholders.
10. color-scheme meta: light only.

Known Kissflow field names for this app (context only — do NOT invent new {{FieldName}} tokens from these unless they already appear in the allowed placeholder list): ${fieldNames.length ? fieldNames.join(', ') : '(none synced yet)'}.`;
}

function buildUserPrompt({
  prompt,
  appName,
  starterId,
  currentHtml,
  includeCurrentHtml,
}) {
  const parts = [
    `Application: ${appName}`,
    `Recommended starter style: ${starterId}`,
    `User design comments / prompt:\n${prompt}`,
  ];
  if (includeCurrentHtml && currentHtml && String(currentHtml).trim()) {
    parts.push(
      'Revise the following current HTML according to the prompt. Keep email-safe patterns and allowed placeholders:\n```html\n'
        + String(currentHtml).slice(0, 40000)
        + '\n```',
    );
  } else {
    parts.push(
      'Create a fresh HTML report layout from the prompt. You may use the recommended starter style as inspiration.',
    );
  }
  return parts.join('\n\n');
}

function stripModelHtml(raw) {
  let text = String(raw || '').trim();
  if (!text) return '';
  const fenced = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  const doctype = text.search(/<!DOCTYPE/i);
  const htmlTag = text.search(/<html[\s>]/i);
  const start = doctype >= 0 ? doctype : htmlTag;
  if (start > 0) text = text.slice(start);
  const end = text.toLowerCase().lastIndexOf('</html>');
  if (end >= 0) text = text.slice(0, end + '</html>'.length);
  return text.trim();
}

async function callGeminiApiKey({ apiKey, model, systemPrompt, userPrompt }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 8192,
      },
    }),
    signal: AbortSignal.timeout(90000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || `Gemini API error (${res.status})`;
    const err = new Error(msg);
    err.code = 'GEMINI_API_FAILED';
    err.status = res.status >= 400 && res.status < 500 ? 502 : 502;
    throw err;
  }
  const text = body?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  return text;
}

async function callVertexGemini({ projectId, location, model, accessToken, systemPrompt, userPrompt }) {
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 8192,
      },
    }),
    signal: AbortSignal.timeout(90000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || `Vertex AI error (${res.status})`;
    const err = new Error(msg);
    err.code = 'VERTEX_AI_FAILED';
    err.status = 502;
    throw err;
  }
  const text = body?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  return text;
}

async function generateModelText({ systemPrompt, userPrompt }) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
  const model = resolveModel();

  if (apiKey) {
    // Google AI Studio keys often use short model ids.
    const apiModel = process.env.GEMINI_API_MODEL || model.replace(/-001$/, '') || 'gemini-2.5-flash';
    return {
      provider: 'gemini_api_key',
      model: apiModel,
      text: await callGeminiApiKey({
        apiKey,
        model: apiModel,
        systemPrompt,
        userPrompt,
      }),
    };
  }

  const projectId = resolveProjectId();
  if (!projectId) {
    const err = new Error(
      'AI is not configured. Set GEMINI_API_KEY (local) or GCP_PROJECT + Vertex AI (Cloud Run).',
    );
    err.code = 'AI_NOT_CONFIGURED';
    err.status = 503;
    throw err;
  }

  let accessToken;
  try {
    accessToken = await fetchMetadataAccessToken();
  } catch (metaErr) {
    const err = new Error(
      `AI requires GEMINI_API_KEY locally (metadata token unavailable: ${metaErr.message})`,
    );
    err.code = 'AI_NOT_CONFIGURED';
    err.status = 503;
    throw err;
  }

  const location = resolveVertexLocation();
  try {
    return {
      provider: 'vertex',
      model,
      location,
      text: await callVertexGemini({
        projectId,
        location,
        model,
        accessToken,
        systemPrompt,
        userPrompt,
      }),
    };
  } catch (err) {
    // asia-south1 may not host every Gemini model — retry us-central1 once.
    if (location !== 'us-central1') {
      return {
        provider: 'vertex',
        model,
        location: 'us-central1',
        text: await callVertexGemini({
          projectId,
          location: 'us-central1',
          model,
          accessToken,
          systemPrompt,
          userPrompt,
        }),
      };
    }
    throw err;
  }
}

/**
 * Generate email-safe report HTML from a natural-language prompt.
 */
async function generateReportHtmlFromPrompt({
  environment,
  applicationId,
  prompt,
  currentHtml = '',
  includeCurrentHtml = false,
  templateName = '',
}) {
  const cleanedPrompt = String(prompt || '').trim();
  if (cleanedPrompt.length < 8) {
    const err = new Error('Prompt is too short — describe the report layout you want.');
    err.code = 'PROMPT_REQUIRED';
    err.status = 400;
    throw err;
  }
  if (cleanedPrompt.length > 4000) {
    const err = new Error('Prompt is too long (max 4000 characters).');
    err.code = 'PROMPT_TOO_LONG';
    err.status = 400;
    throw err;
  }

  const appCtx = await loadAppAiContext(environment, applicationId);
  const starterId = suggestStarterId(applicationId, {
    applicationName: appCtx.application_name,
    processIds: appCtx.process_ids,
    processNames: appCtx.process_names,
    fieldNames: appCtx.field_names,
  });
  const placeholders = allowedPlaceholdersForStarter(starterId);
  const appName = templateName || appCtx.application_name || applicationId;

  const systemPrompt = buildSystemPrompt({
    appName,
    starterId,
    placeholders,
    fieldNames: appCtx.field_names,
  });
  const userPrompt = buildUserPrompt({
    prompt: cleanedPrompt,
    appName,
    starterId,
    currentHtml,
    includeCurrentHtml: Boolean(includeCurrentHtml),
  });

  let modelResult;
  try {
    modelResult = await generateModelText({ systemPrompt, userPrompt });
  } catch (err) {
    // Soft fallback: if AI is unavailable, return the recommended starter so the UI still helps.
    if (err.code === 'AI_NOT_CONFIGURED') throw err;
    throw err;
  }

  let html = stripModelHtml(modelResult.text);
  if (!html || !/<html[\s>]/i.test(html)) {
    // Last resort: starter HTML so the editor is never empty after a partial model response.
    html = getStarterHtml(starterId, appName);
    modelResult.fallback = 'starter_html';
  }

  html = normalizeReportTemplateHtml(html);

  return {
    html,
    starter_id: starterId,
    placeholders,
    provider: modelResult.provider,
    model: modelResult.model,
    location: modelResult.location || null,
    fallback: modelResult.fallback || null,
    application_name: appName,
    field_count: appCtx.field_names.length,
  };
}

module.exports = {
  generateReportHtmlFromPrompt,
  isAiConfigured,
};
