#!/usr/bin/env tsx
/**
 * Georgian Law MCP -- Real ingestion from matsne.gov.ge
 *
 * Corpus strategy:
 * - Active code corpus from /ka/active-codes
 * - Top legal documents from /ka/top
 * - Explicitly added key acts (PDP, information security, etc.)
 *
 * If a document is blocked/inaccessible, it is skipped and logged.
 * No synthetic fallback text is generated.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { fetchWithRateLimit } from './lib/fetcher.js';
import {
  parseMatsneEnglishTitle,
  parseMatsneMetadata,
  parseMatsneProvisions,
  type ParsedAct,
} from './lib/parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SEED_DIR = path.resolve(__dirname, '../data/seed');
const REPORT_PATH = path.resolve(__dirname, '../data/ingestion-report.json');

const MATSNE_BASE = 'https://www.matsne.gov.ge';
const KA_VIEW = `${MATSNE_BASE}/ka/document/view`;

const LISTING_URLS = [
  `${MATSNE_BASE}/ka/active-codes`,
  `${MATSNE_BASE}/ka/top`,
];

const EXTRA_DOCUMENT_IDS = [
  1561437, // პერსონალურ მონაცემთა დაცვის შესახებ
  1679424, // ინფორმაციული უსაფრთხოების შესახებ
  16270, // ზოგადი ადმინისტრაციული კოდექსი
  16426, // სისხლის სამართლის კოდექსი
];

const FRIENDLY_IDS: Record<number, string> = {
  1561437: 'ge-personal-data-protection',
  1679424: 'ge-information-security',
  16270: 'ge-general-administrative-code',
  16426: 'ge-criminal-code',
  90034: 'ge-criminal-procedure-code',
  31702: 'ge-civil-code',
  29962: 'ge-civil-procedure-code',
  28216: 'ge-administrative-offences-code',
  30346: 'ge-constitution',
};

interface IngestResult {
  documentId: number;
  status: 'ingested' | 'skipped';
  reason?: string;
  seedId?: string;
  url?: string;
  title?: string;
  provisions?: number;
  definitions?: number;
}

function parseArgs(): { limit: number | null } {
  const args = process.argv.slice(2);
  let limit: number | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return { limit };
}

function extractDocumentIds(html: string): number[] {
  const ids = [...html.matchAll(/\/ka\/document\/view\/(\d+)/g)].map(m => Number(m[1]));
  return Array.from(new Set(ids)).filter(Number.isFinite);
}

function makeDocumentSeedId(documentId: number): string {
  return FRIENDLY_IDS[documentId] ?? `ge-doc-${documentId}`;
}

function makeShortName(title: string, documentId: number): string {
  if (/კოდექსი/.test(title)) {
    return `კოდექსი-${documentId}`;
  }
  if (/კანონი/.test(title)) {
    return `კანონი-${documentId}`;
  }
  return `DOC-${documentId}`;
}

function cleanSeedDir(): void {
  fs.mkdirSync(SEED_DIR, { recursive: true });
  const existing = fs.readdirSync(SEED_DIR).filter(f => f.endsWith('.json'));
  for (const file of existing) {
    fs.unlinkSync(path.join(SEED_DIR, file));
  }
}

function safeTitleEn(kaTitle: string, enTitle?: string): string | undefined {
  if (!enTitle) return undefined;
  const normalizedKa = kaTitle.trim();
  const normalizedEn = enTitle.trim();
  if (!normalizedEn || normalizedEn === normalizedKa) return undefined;
  return normalizedEn;
}

function buildDocumentUrl(documentId: number, publicationId?: number): string {
  if (!publicationId) return `${KA_VIEW}/${documentId}`;
  return `${KA_VIEW}/${documentId}?publication=${publicationId}`;
}

async function fetchListingDocumentIds(): Promise<number[]> {
  const allIds: number[] = [];

  for (const url of LISTING_URLS) {
    const response = await fetchWithRateLimit(url);
    if (response.blocked || response.status !== 200) {
      console.warn(`  Listing unavailable: ${url} (status ${response.status})`);
      continue;
    }
    allIds.push(...extractDocumentIds(response.body));
  }

  return Array.from(new Set(allIds));
}

async function fetchEnglishTitle(documentId: number, publicationId?: number): Promise<string | undefined> {
  const enUrl = buildDocumentUrl(documentId, publicationId).replace('/ka/', '/en/');
  try {
    const response = await fetchWithRateLimit(enUrl);
    if (response.blocked || response.status !== 200) return undefined;
    return parseMatsneEnglishTitle(response.body);
  } catch {
    return undefined;
  }
}

async function ingestDocument(documentId: number): Promise<{ result: IngestResult; seed?: ParsedAct }> {
  const baseUrl = buildDocumentUrl(documentId);
  const metaResponse = await fetchWithRateLimit(baseUrl);

  if (metaResponse.blocked) {
    return {
      result: {
        documentId,
        status: 'skipped',
        reason: `blocked${metaResponse.blockReferenceId ? ` (Ref ID ${metaResponse.blockReferenceId})` : ''}`,
      },
    };
  }
  if (metaResponse.status !== 200) {
    return {
      result: {
        documentId,
        status: 'skipped',
        reason: `HTTP ${metaResponse.status}`,
      },
    };
  }

  const meta = parseMatsneMetadata(metaResponse.body, documentId);
  const publicationId = meta.latestPublicationId;
  const finalUrl = buildDocumentUrl(documentId, publicationId);

  const pageResponse =
    finalUrl === baseUrl ? metaResponse : await fetchWithRateLimit(finalUrl);
  if (pageResponse.blocked) {
    return {
      result: {
        documentId,
        status: 'skipped',
        reason: `blocked on publication page${pageResponse.blockReferenceId ? ` (Ref ID ${pageResponse.blockReferenceId})` : ''}`,
      },
    };
  }
  if (pageResponse.status !== 200) {
    return {
      result: {
        documentId,
        status: 'skipped',
        reason: `HTTP ${pageResponse.status} on publication page`,
      },
    };
  }

  const parsed = parseMatsneProvisions(pageResponse.body);
  if (parsed.provisions.length === 0) {
    return {
      result: {
        documentId,
        status: 'skipped',
        reason: 'no provisions parsed',
      },
    };
  }

  const titleEn = meta.hasEnglishVersion
    ? safeTitleEn(meta.title, await fetchEnglishTitle(documentId, publicationId))
    : undefined;

  const seed: ParsedAct = {
    id: makeDocumentSeedId(documentId),
    type: 'statute',
    title: meta.title,
    title_en: titleEn,
    short_name: makeShortName(meta.title, documentId),
    status: 'in_force',
    issued_date: meta.issuedDate,
    in_force_date: meta.issuedDate,
    url: finalUrl,
    description: 'Official consolidated legislation text published by the Legislative Herald of Georgia (matsne.gov.ge).',
    provisions: parsed.provisions,
    definitions: parsed.definitions,
  };

  return {
    result: {
      documentId,
      status: 'ingested',
      seedId: seed.id,
      title: seed.title,
      url: seed.url,
      provisions: seed.provisions.length,
      definitions: seed.definitions.length,
    },
    seed,
  };
}

async function main(): Promise<void> {
  const { limit } = parseArgs();

  console.log('Georgian Law MCP -- Real Matsne ingestion');
  console.log('=========================================');
  console.log(`Source listings: ${LISTING_URLS.join(', ')}`);
  if (limit) console.log(`Limit: ${limit}`);
  console.log('');

  const listingIds = await fetchListingDocumentIds();
  const candidateIds = Array.from(new Set([...listingIds, ...EXTRA_DOCUMENT_IDS])).sort((a, b) => a - b);
  const selectedIds = limit ? candidateIds.slice(0, limit) : candidateIds;

  console.log(`Discovered ${listingIds.length} listing IDs; ingesting ${selectedIds.length} documents total.`);
  console.log('');

  cleanSeedDir();

  const results: IngestResult[] = [];
  const seeds: ParsedAct[] = [];

  for (let i = 0; i < selectedIds.length; i++) {
    const id = selectedIds[i];
    process.stdout.write(`[${String(i + 1).padStart(2, '0')}/${selectedIds.length}] ${id} ... `);

    try {
      const { result, seed } = await ingestDocument(id);
      results.push(result);

      if (seed) {
        seeds.push(seed);
        console.log(`OK (${seed.provisions.length} provisions, ${seed.definitions.length} definitions)`);
      } else {
        console.log(`SKIP (${result.reason})`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ documentId: id, status: 'skipped', reason: message });
      console.log(`SKIP (${message})`);
    }
  }

  // Deterministic ordering by seed id.
  seeds.sort((a, b) => a.id.localeCompare(b.id));
  const pad = Math.max(2, String(seeds.length).length);

  for (let i = 0; i < seeds.length; i++) {
    const fileName = `${String(i + 1).padStart(pad, '0')}-${seeds[i].id}.json`;
    fs.writeFileSync(path.join(SEED_DIR, fileName), `${JSON.stringify(seeds[i], null, 2)}\n`);
  }

  const ingested = results.filter(r => r.status === 'ingested');
  const skipped = results.filter(r => r.status === 'skipped');

  const report = {
    generated_at: new Date().toISOString(),
    source: 'https://www.matsne.gov.ge',
    listing_urls: LISTING_URLS,
    discovered_listing_ids: listingIds.length,
    selected_ids: selectedIds.length,
    ingested_documents: ingested.length,
    skipped_documents: skipped.length,
    total_provisions: ingested.reduce((sum, r) => sum + (r.provisions ?? 0), 0),
    total_definitions: ingested.reduce((sum, r) => sum + (r.definitions ?? 0), 0),
    skipped_reasons: skipped,
  };

  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  console.log('\nIngestion summary');
  console.log('-----------------');
  console.log(`Ingested: ${ingested.length}`);
  console.log(`Skipped:  ${skipped.length}`);
  console.log(`Seeds:    ${seeds.length}`);
  console.log(`Output:   ${SEED_DIR}`);
  console.log(`Report:   ${REPORT_PATH}`);
}

main().catch(error => {
  console.error('Fatal ingestion error:', error);
  process.exit(1);
});

