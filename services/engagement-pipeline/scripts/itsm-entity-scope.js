'use strict';

/**
 * Non-Refex Tech Helpdesk entities share Live_IT_Service_Request_Extrovis_A00.
 * Match Entity the same way aasik_ITSM normalizeEntityKey does (token includes).
 */

function entityToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function canonicalItsmEntityFilter(filter) {
  const token = entityToken(filter);
  if (!token || token === 'all' || token === '*') return '';
  if (token === 'refex') return 'refex';
  if (token.includes('extrovis')) return 'extrovis';
  if (token.includes('kavis')) return 'kavis';
  if (token.includes('modepro')) return 'modepro';
  if (token.includes('pharmapack') || (token.includes('pharma') && token.includes('pack'))) {
    return 'pharmapack';
  }
  return token;
}

/**
 * @param {string} entityRaw — Kissflow Entity column / payload value
 * @param {string} filter — schedule entity_filter (Extrovis | Kavispharma | Modepro | …)
 */
function itsmEntityMatchesFilter(entityRaw, filter) {
  const want = canonicalItsmEntityFilter(filter);
  if (!want) return true;
  const have = entityToken(entityRaw);
  if (want === 'refex') {
    return !have || have.includes('refex');
  }
  if (want === 'extrovis') return have.includes('extrovis');
  if (want === 'kavis') return have.includes('kavis');
  if (want === 'modepro') return have.includes('modepro');
  if (want === 'pharmapack') {
    return have.includes('pharmapack') || (have.includes('pharma') && have.includes('pack'));
  }
  return have === want || have.includes(want) || want.includes(have);
}

module.exports = {
  entityToken,
  canonicalItsmEntityFilter,
  itsmEntityMatchesFilter,
};
