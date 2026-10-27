import { describe, expect, it } from 'vitest';
import { EXTERNAL_GCP_APIS } from './externalGcpApis';

describe('EXTERNAL_GCP_APIS', () => {
  it('includes keyword matching and the comments chat API', () => {
    const ids = EXTERNAL_GCP_APIS.map((api) => api.id);
    expect(ids).toContain('keyword-matching');
    expect(ids).toContain('comment-mail');
    expect(new Set(ids).size).toBe(ids.length);
    for (const api of EXTERNAL_GCP_APIS) {
      expect(api.baseUrl.startsWith('https://')).toBe(true);
      expect(api.endpoints.length).toBeGreaterThan(0);
      expect(api.auth.toLowerCase()).not.toContain('cmk_');
    }
  });
});