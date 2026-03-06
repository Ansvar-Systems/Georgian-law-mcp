/**
 * Response metadata utilities for Georgian Law MCP.
 */

import type Database from '@ansvar/mcp-sqlite';

export interface ResponseMetadata {
  data_source: string;
  jurisdiction: string;
  disclaimer: string;
  freshness?: string;
  note?: string;
  query_strategy?: string;
}

export interface ToolResponse<T> {
  results: T;
  _metadata: ResponseMetadata;
}

export function generateResponseMetadata(
  db: InstanceType<typeof Database>,
): ResponseMetadata {
  let freshness: string | undefined;
  try {
    const row = db.prepare(
      "SELECT value FROM db_metadata WHERE key = 'built_at'"
    ).get() as { value: string } | undefined;
    if (row) freshness = row.value;
  } catch {
    // Ignore
  }

  return {
    data_source: 'Legislative Herald of Georgia (matsne.gov.ge) — Ministry of Justice of Georgia',
    jurisdiction: 'GE',
    disclaimer:
      'This data is sourced from the Legislative Herald of Georgia under public domain. ' +
      'The authoritative versions are maintained by the Ministry of Justice of Georgia (matsne.gov.ge). ' +
      'Always verify with the official Legislative Herald portal (matsne.gov.ge).',
    freshness,
  };
}
