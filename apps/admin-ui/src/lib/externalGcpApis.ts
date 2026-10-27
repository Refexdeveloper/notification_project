export type ExternalApiEndpoint = {
  method: string;
  path: string;
  detail: string;
};

export type ExternalGcpApi = {
  id: string;
  name: string;
  service: string;
  summary: string;
  baseUrl: string;
  auth: string;
  usedBy: string;
  endpoints: ExternalApiEndpoint[];
  request?: string;
  response?: string;
  docsUrl?: string;
};

/** Public Cloud Run APIs called from outside Notification Engine. Keys are never shown. */
export const EXTERNAL_GCP_APIS: ExternalGcpApi[] = [
  {
    id: 'keyword-matching',
    name: 'Keyword matching API',
    service: 'keyword-matching-api',
    summary: 'Reads the message text, matches it to phrases in BigQuery, and returns the IT ticket sub-type.',
    baseUrl: 'https://keyword-matching-api-dhwffeu7pq-el.a.run.app',
    auth: 'Public invoke. The match call does not require an API key.',
    usedBy: 'Refex One chat and the WhatsApp IT Help Desk flow.',
    docsUrl: 'https://keyword-matching-api-dhwffeu7pq-el.a.run.app/docs',
    request: '{ "mail_body": "laptop is not connecting to wifi", "subject": "", "from_email": "", "message_id": "" }',
    response: '{ "sub_type": "Network", "matched_keyword": "wifi", "score": 1, "status": "SUCCESS" }',
    endpoints: [
      { method: 'POST', path: '/api/v1/keyword-match', detail: 'Match mail_body to a sub-type. status is SUCCESS or NO_MATCH.' },
      { method: 'GET', path: '/health', detail: 'Service health.' },
      { method: 'GET', path: '/api/v1/keywords', detail: 'Keyword master used by the matcher.' },
      { method: 'GET', path: '/api/v1/learning/pending', detail: 'Phrases waiting for a human check.' },
      { method: 'POST', path: '/api/v1/learning/{log_id}/verify', detail: 'Confirm or correct a learned phrase.' },
      { method: 'GET', path: '/api/v1/reports/daily', detail: 'Daily match report. Other report routes are under /api/v1/reports.' },
    ],
  },
  {
    id: 'comment-mail',
    name: 'Comments chat API',
    service: 'refex-comment-mail',
    summary: 'Sends the email when someone adds a Help Desk chat comment. To stays the existing recipient. From and Cc follow the ticket entity.',
    baseUrl: 'https://refex-comment-mail-dhwffeu7pq-el.a.run.app',
    auth: 'Header X-API-Key or Authorization: Bearer. The key is stored in Secret Manager and is not shown here.',
    usedBy: 'Refex One ITSM comments, and the Extrovis Kissflow comment screens.',
    request: '{ "to": ["requester@example.com"], "cc": ["itsupport@extrovis.com"], "from": "itsupport@extrovis.com", "subject": "Tech Help Desk - New Comment Added | Ticket …", "html": "<p>…</p>" }',
    response: '{ "ok": true, "to": [], "cc": [], "subject": "", "messageId": "" }',
    endpoints: [
      { method: 'POST', path: '/v1/send', detail: 'Send the comment email. to, subject, and html are required. from defaults to itsupport@extrovis.com.' },
      { method: 'GET', path: '/health', detail: 'Service health.' },
      { method: 'GET', path: '/', detail: 'Lists the health and send paths.' },
    ],
  },
  {
    id: 'policy-sender',
    name: 'Policy sender API',
    service: 'policy-sender',
    summary: 'Emails a policy document to the signed-in user from the Refexions chat.',
    baseUrl: 'https://policy-sender-dhwffeu7pq-el.a.run.app',
    auth: 'Header X-API-Key. The key stays on the Refex One server and is not shown here.',
    usedBy: 'Refex One Refexions Policies menu.',
    docsUrl: 'https://policy-sender-dhwffeu7pq-el.a.run.app/docs',
    request: '{ "template_id": "policy_share_v1", "document_id": "it_policy", "user_email": "user@refex.co.in" }',
    response: '{ "status": "sent", "document_id": "it_policy", "to": "user@refex.co.in", "message_id": "" }',
    endpoints: [
      { method: 'POST', path: '/v1/documents/send', detail: 'Send one policy document to user_email.' },
      { method: 'GET', path: '/health', detail: 'Service health.' },
    ],
  },
  {
    id: 'whatsapp-ingress',
    name: 'WhatsApp ingress API',
    service: 'refex-wa-ingress',
    summary: 'Public entry for inbound WhatsApp events. The worker behind it is not public.',
    baseUrl: 'https://refex-wa-ingress-dhwffeu7pq-el.a.run.app',
    auth: 'Public invoke on the ingress service.',
    usedBy: 'WhatsApp provider callbacks.',
    endpoints: [
      { method: 'GET', path: '/', detail: 'Returns refex-wa-ingress up.' },
      { method: 'GET', path: '/health', detail: 'Service health.' },
    ],
  },
  {
    id: 'maps-proxy',
    name: 'Google Maps proxy API',
    service: 'refex-google-maps-proxy',
    summary: 'Public proxy in front of Google Maps so callers do not hold the Maps key.',
    baseUrl: 'https://refex-google-maps-proxy-dhwffeu7pq-el.a.run.app',
    auth: 'Public invoke. The Maps key stays on the service.',
    usedBy: 'Apps that need a map or place lookup without a browser key.',
    endpoints: [
      { method: 'GET', path: '/health', detail: 'Service health. Live request paths appear in the logs below.' },
    ],
  },
  {
    id: 'bulk-bill-ocr',
    name: 'Bulk bill OCR API',
    service: 'bulk-bill-ocr-ingress',
    summary: 'Accepts bulk bill images and publishes them to the OCR topic.',
    baseUrl: 'https://bulk-bill-ocr-ingress-dhwffeu7pq-el.a.run.app',
    auth: 'Public invoke on the ingress service. The worker is private.',
    usedBy: 'Bill capture outside this portal.',
    endpoints: [
      { method: 'GET', path: '/health', detail: 'Returns the service name and topic bulk-bill-ocr-events.' },
    ],
  },
  {
    id: 'travel-ocr',
    name: 'Travel OCR API',
    service: 'travel-ocr-ingress',
    summary: 'Public ingress for travel receipt OCR.',
    baseUrl: 'https://travel-ocr-ingress-dhwffeu7pq-el.a.run.app',
    auth: 'Public invoke on the ingress service.',
    usedBy: 'Travel receipt capture.',
    endpoints: [
      { method: 'GET', path: '/health', detail: 'Service health. Live request paths appear in the logs below.' },
    ],
  },
  {
    id: 'unfyd-ocr',
    name: 'Unfyd OCR API',
    service: 'refex-unfyd-ocr-prod',
    summary: 'Production OCR used as a Kissflow button action.',
    baseUrl: 'https://refex-unfyd-ocr-prod-dhwffeu7pq-el.a.run.app',
    auth: 'Public invoke.',
    usedBy: 'Kissflow button actions.',
    endpoints: [
      { method: 'GET', path: '/health', detail: 'Reports mode kissflow-button-action.' },
    ],
  },
  {
    id: 'tally-voucher',
    name: 'Tally voucher posting API',
    service: 'refex-ems-tally-voucher-posting',
    summary: 'Posts expense vouchers onward to Tally.',
    baseUrl: 'https://refex-ems-tally-voucher-posting-dhwffeu7pq-el.a.run.app',
    auth: 'Public invoke.',
    usedBy: 'Expense Management voucher posting.',
    endpoints: [
      { method: 'GET', path: '/health', detail: 'Returns state ready when the service can post.' },
    ],
  },
];
