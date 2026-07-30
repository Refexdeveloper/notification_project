export type ResourceKind = 'process' | 'dataform' | 'board' | 'dataset' | 'account';

export interface ApiEndpoint {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path relative to host, with placeholders: {account_id}, {resource_id}, {item_id} */
  path: string;
  name: string;
  description: string;
  resourceKinds: ResourceKind[];
  queryParams?: { name: string; example: string; required?: boolean }[];
  bodyExample?: string;
  sampleResponse: string;
}

export interface AppConnection {
  appId: string;
  baseUrl: string;
  accessKeyId: string;
  accessKeySecretMasked: string;
  authType: 'access_key' | 'oauth' | 'api_key';
  headers: { key: string; value: string }[];
  lastTestedAt: string | null;
  lastTestStatus: 'success' | 'failed' | 'untested';
  lastLatencyMs: number | null;
}

/** Kissflow REST endpoints aligned with public API docs */
export const kissflowApiCatalog: ApiEndpoint[] = [
  // Account / users
  {
    id: 'get-user-list',
    method: 'GET',
    path: '/user/2/{account_id}',
    name: 'Get user list',
    description: 'Fetch all users in the Kissflow account (paginated). Official directory API.',
    resourceKinds: ['account'],
    queryParams: [
      { name: 'page_number', example: '1' },
      { name: 'page_size', example: '1000' },
    ],
    sampleResponse: `[\n  { "_id": "User_1", "Name": "Alex Morgan", "Status": "Active", "UserType": "User" }\n]`,
  },
  {
    id: 'get-group-list',
    method: 'GET',
    path: '/group/2/{account_id}/list',
    name: 'Get list of groups',
    description: 'Retrieve groups for recipient resolution.',
    resourceKinds: ['account'],
    queryParams: [
      { name: 'page_number', example: '1' },
      { name: 'page_size', example: '1000' },
    ],
    sampleResponse: `[\n  { "_id": "Group_HR", "Name": "HR", "UserCount": 12 }\n]`,
  },

  // Processes — prefer non-admin endpoints (admin APIs require elevated Access Keys)
  {
    id: 'process-my-items',
    method: 'GET',
    path: '/process/2/{account_id}/{resource_id}/myitems',
    name: 'Get list of my items',
    description: 'List items initiated by the authenticated user in this process. Works with standard Access Keys.',
    resourceKinds: ['process'],
    queryParams: [
      { name: 'page_number', example: '1' },
      { name: 'page_size', example: '1000' },
    ],
    sampleResponse: `{\n  "Data": [{ "_id": "Item_1001", "Status": "InProgress" }],\n  "TotalCount": 1\n}`,
  },
  {
    id: 'process-my-tasks',
    method: 'GET',
    path: '/process/2/{account_id}/{resource_id}/mytasks',
    name: 'Get list of my tasks',
    description: 'List tasks assigned to the authenticated user. Works with standard Access Keys.',
    resourceKinds: ['process'],
    queryParams: [
      { name: 'page_number', example: '1' },
      { name: 'page_size', example: '1000' },
    ],
    sampleResponse: `{\n  "Data": [{ "_id": "Item_1002", "ActivityName": "Manager Approval", "Status": "Assigned" }]\n}`,
  },
  {
    id: 'process-item-details',
    method: 'GET',
    path: '/process/2/{account_id}/{resource_id}/{item_id}',
    name: 'Get item details',
    description: 'Retrieve details for a specific process item (non-admin).',
    resourceKinds: ['process'],
    sampleResponse: `{\n  "_id": "Item_1001",\n  "Status": "InProgress",\n  "CreatedBy": { "Name": "Alex Morgan" }\n}`,
  },
  {
    id: 'process-create-item',
    method: 'POST',
    path: '/process/2/{account_id}/{resource_id}',
    name: 'Create a new item',
    description: 'Create a new process item (draft).',
    resourceKinds: ['process'],
    bodyExample: `{\n  "Subject": "New request",\n  "Description": "Created from Notification Engine"\n}`,
    sampleResponse: `{\n  "_id": "Item_1003",\n  "Status": "Draft"\n}`,
  },
  {
    id: 'process-submit-item',
    method: 'POST',
    path: '/process/2/{account_id}/{resource_id}/{item_id}/submit',
    name: 'Submit an item',
    description: 'Submit a process item to the next workflow step.',
    resourceKinds: ['process'],
    bodyExample: `{\n  "Comments": "Please review"\n}`,
    sampleResponse: `{\n  "_id": "Item_1003",\n  "Status": "InProgress"\n}`,
  },
  {
    id: 'process-admin-items',
    method: 'GET',
    // Real Kissflow shape: /process/2/{account_id}/admin/{process_id}/item
    path: '/process/2/{account_id}/admin/{resource_id}/item',
    name: 'Get all items (Admin)',
    description:
      'Admin-only listing of ALL process items. Requires an Admin Access Key. Prefer "Get list of my items" / "Get list of my tasks" for standard keys.',
    resourceKinds: ['process'],
    queryParams: [
      { name: 'page_number', example: '1' },
      { name: 'page_size', example: '1000' },
      { name: 'apply_preference', example: '1' },
    ],
    sampleResponse: `{\n  "Data": [{ "_id": "Item_1001", "Status": "Completed" }],\n  "TotalCount": 1\n}`,
  },
  {
    id: 'process-get-item-admin',
    method: 'GET',
    path: '/process/2/{account_id}/admin/{resource_id}/{item_id}',
    name: 'Get item details (Admin)',
    description:
      'Admin-only item details. Returns 403 without admin Access Key. Use "Get item details" instead for standard keys.',
    resourceKinds: ['process'],
    sampleResponse: `{\n  "_id": "Item_1001",\n  "Status": "InProgress",\n  "CreatedBy": { "Name": "Alex Morgan" }\n}`,
  },

  // Dataforms
  {
    id: 'dataform-get-all',
    method: 'GET',
    path: '/form/2/{account_id}/{resource_id}',
    name: 'Get all dataform records',
    description: 'List all records in this dataform.',
    resourceKinds: ['dataform'],
    queryParams: [
      { name: 'page_number', example: '1' },
      { name: 'page_size', example: '1000' },
    ],
    sampleResponse: `{\n  "Data": [{ "_id": "Rec_1", "Name": "Jane Doe" }],\n  "TotalCount": 1\n}`,
  },
  {
    id: 'dataform-get-record',
    method: 'GET',
    path: '/form/2/{account_id}/{resource_id}/{item_id}',
    name: 'Get details of a dataform record',
    description: 'Fetch a single dataform record by ID.',
    resourceKinds: ['dataform'],
    sampleResponse: `{\n  "_id": "Rec_1",\n  "employee_name": "Jane Doe",\n  "department": "Engineering"\n}`,
  },
  {
    id: 'dataform-create',
    method: 'POST',
    path: '/form/2/{account_id}/{resource_id}',
    name: 'Create a new dataform record',
    description: 'Create a record in this dataform.',
    resourceKinds: ['dataform'],
    bodyExample: `{\n  "employee_name": "Jane Doe",\n  "department": "Engineering"\n}`,
    sampleResponse: `{\n  "_id": "Rec_2",\n  "Status": "Created"\n}`,
  },
  {
    id: 'dataform-update',
    method: 'POST',
    path: '/form/2/{account_id}/{resource_id}/{item_id}',
    name: 'Update dataform record',
    description: 'Update fields on an existing dataform record.',
    resourceKinds: ['dataform'],
    bodyExample: `{\n  "department": "Product"\n}`,
    sampleResponse: `{\n  "_id": "Rec_1",\n  "department": "Product"\n}`,
  },
  {
    id: 'dataform-delete',
    method: 'DELETE',
    path: '/form/2/{account_id}/{resource_id}/{item_id}',
    name: 'Delete a dataform record',
    description: 'Delete a dataform record by ID.',
    resourceKinds: ['dataform'],
    sampleResponse: `{\n  "success": true\n}`,
  },

  // Boards
  {
    id: 'board-get-items',
    method: 'GET',
    path: '/board/2/{account_id}/{resource_id}/item',
    name: "Get all items' details",
    description: 'List board items with details.',
    resourceKinds: ['board'],
    sampleResponse: `{\n  "Data": [{ "_id": "Card_1", "Title": "New hire setup", "Status": "Open" }]\n}`,
  },
  {
    id: 'board-get-fields',
    method: 'GET',
    path: '/board/2/{account_id}/{resource_id}/field',
    name: 'Get all board fields',
    description: 'Retrieve field metadata for this board (useful for notification variables).',
    resourceKinds: ['board'],
    sampleResponse: `{\n  "Fields": [\n    { "Id": "Title", "Type": "Text" },\n    { "Id": "Assignee", "Type": "User" },\n    { "Id": "DueDate", "Type": "DateTime" }\n  ]\n}`,
  },
  {
    id: 'board-create-item',
    method: 'POST',
    path: '/board/2/{account_id}/{resource_id}',
    name: 'Create a new item',
    description: 'Create a new board card/item.',
    resourceKinds: ['board'],
    bodyExample: `{\n  "Title": "Follow up onboarding",\n  "Priority": "High"\n}`,
    sampleResponse: `{\n  "_id": "Card_2",\n  "Status": "Open"\n}`,
  },
  {
    id: 'board-update-status',
    method: 'POST',
    path: '/board/2/{account_id}/{resource_id}/{item_id}/status',
    name: 'Update the status of an item',
    description: 'Change board item status.',
    resourceKinds: ['board'],
    bodyExample: `{\n  "Status": "Done"\n}`,
    sampleResponse: `{\n  "_id": "Card_1",\n  "Status": "Done"\n}`,
  },
  {
    id: 'board-view-items',
    method: 'POST',
    path: '/board/2/{account_id}/{resource_id}/view/{item_id}/list',
    name: 'Get the list of items in a view',
    description: 'List items in a board view (item_id = view id).',
    resourceKinds: ['board'],
    bodyExample: `{\n  "page_number": 1,\n  "page_size": 1000\n}`,
    sampleResponse: `{\n  "Data": [{ "_id": "Card_1", "Title": "New hire setup" }],\n  "TotalCount": 1\n}`,
  },

  // Datasets
  {
    id: 'dataset-get-all',
    method: 'GET',
    path: '/dataset/2/{account_id}/{resource_id}',
    name: 'Get all dataset records',
    description: 'List records in this dataset.',
    resourceKinds: ['dataset'],
    sampleResponse: `{\n  "Data": [{ "_id": "Row_1", "Code": "ENG" }],\n  "TotalCount": 1\n}`,
  },
  {
    id: 'dataset-get-record',
    method: 'GET',
    path: '/dataset/2/{account_id}/{resource_id}/{item_id}',
    name: 'Get dataset record',
    description: 'Fetch a single dataset record.',
    resourceKinds: ['dataset'],
    sampleResponse: `{\n  "_id": "Row_1",\n  "Code": "ENG",\n  "Name": "Engineering"\n}`,
  },
];

export function getEndpointsForKind(kind: ResourceKind): ApiEndpoint[] {
  return kissflowApiCatalog.filter((e) => e.resourceKinds.includes(kind));
}

/** @deprecated use kissflowApiCatalog */
export const kissflowApiEndpoints = kissflowApiCatalog;

export function getConnection(appId: string): AppConnection {
  try {
    const raw = localStorage.getItem('ne_applications');
    if (raw) {
      const apps = JSON.parse(raw) as Array<{
        id: string;
        subdomain?: string;
        region?: string;
        accessKeyId?: string;
        accessKeySecret?: string;
      }>;
      const app = apps.find((a) => a.id === appId);
      if (app) {
        const host = `https://${app.subdomain || 'subdomain'}.kissflow.${app.region || 'com'}`;
        return {
          appId,
          baseUrl: host,
          accessKeyId: app.accessKeyId || '',
          accessKeySecretMasked: app.accessKeySecret ? '••••••••••••••••' : '',
          authType: 'access_key',
          headers: [
            { key: 'Accept', value: 'application/json' },
            { key: 'X-Access-Key-Id', value: app.accessKeyId || '' },
            { key: 'X-Access-Key-Secret', value: '••••••••' },
          ],
          lastTestedAt: null,
          lastTestStatus: 'untested',
          lastLatencyMs: null,
        };
      }
    }
  } catch {
    /* ignore */
  }

  return {
    appId,
    baseUrl: 'https://subdomain.kissflow.com',
    accessKeyId: '',
    accessKeySecretMasked: '',
    authType: 'access_key',
    headers: [{ key: 'Accept', value: 'application/json' }],
    lastTestedAt: null,
    lastTestStatus: 'untested',
    lastLatencyMs: null,
  };
}

export function buildKissflowUrl(
  host: string,
  pathTemplate: string,
  params: { accountId: string; resourceId?: string; itemId?: string },
  queryParams?: { name: string; example: string }[],
): string {
  const path = pathTemplate
    .replace('{account_id}', encodeURIComponent(params.accountId))
    .replace('{resource_id}', encodeURIComponent(params.resourceId || ''))
    .replace('{item_id}', encodeURIComponent(params.itemId || 'ITEM_ID'));
  const qs =
    queryParams && queryParams.length
      ? `?${queryParams.map((q) => `${encodeURIComponent(q.name)}=${encodeURIComponent(q.example)}`).join('&')}`
      : '';
  return `${host.replace(/\/$/, '')}${path}${qs}`;
}

export function buildCurl(
  method: string,
  url: string,
  accessKeyId: string,
  accessKeySecret: string,
  body?: string,
): string {
  const lines = [
    `curl --location '${url}' \\`,
    `--header 'Accept: application/json' \\`,
    `--header 'X-Access-Key-Id: ${accessKeyId || '<access_key_id>'}' \\`,
    `--header 'X-Access-Key-Secret: ${accessKeySecret || '<access_key_secret>'}'`,
  ];
  if (body && method !== 'GET' && method !== 'DELETE') {
    lines[lines.length - 1] += ' \\';
    lines.push(`--header 'Content-Type: application/json' \\`);
    lines.push(`--data '${body.replace(/\n/g, ' ')}'`);
  }
  return lines.join('\n');
}
