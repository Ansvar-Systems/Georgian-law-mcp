#!/usr/bin/env tsx
/**
 * Georgian Law MCP -- Real ingestion from matsne.gov.ge
 *
 * Modes:
 * - curated: active-codes + top + explicit key laws (default)
 * - full-laws: all consolidated normative laws (group=1000003)
 * - full-main-normative: all consolidated normative acts
 *
 * No synthetic fallback text is generated.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { fetchBinaryWithRateLimit, fetchWithRateLimit } from './lib/fetcher.js';
import {
  parseMatsneEnglishTitle,
  parseMatsneMetadata,
  parseMatsneProvisions,
  parseMatsneProvisionsFromPlainText,
  type ParsedAct,
} from './lib/parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SEED_DIR = path.resolve(__dirname, '../data/seed');
const REPORT_PATH = path.resolve(__dirname, '../data/ingestion-report.json');

const MATSNE_BASE = 'https://www.matsne.gov.ge';
const KA_VIEW = `${MATSNE_BASE}/ka/document/view`;
const SEARCH_URL = `${MATSNE_BASE}/ka/document/search`;
const DOC_CONVERSION_TIMEOUT_MS = 180_000;

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

type IngestionMode = 'curated' | 'full-laws' | 'full-main-normative';

interface CliOptions {
  mode: IngestionMode;
  limit: number | null;
  maxPages: number | null;
  clean: boolean;
  resume: boolean;
  skipEnglish: boolean;
  quiet: boolean;
}

interface IngestResult {
  documentId: number;
  status: 'ingested' | 'skipped' | 'already_present';
  reason?: string;
  seedId?: string;
  url?: string;
  title?: string;
  provisions?: number;
  definitions?: number;
}

interface DiscoverySummary {
  strategy: 'curated' | 'search';
  listing_urls?: string[];
  discovered_listing_ids?: number;
  search_profile?: string;
  search_params?: Record<string, string>;
  search_total_results?: number;
  search_pages_fetched?: number;
  search_last_page?: number;
}

const SEARCH_PROFILES: Record<Exclude<IngestionMode, 'curated'>, Record<string, string>> = {
  'full-laws': {
    type: 'main',
    additional_status: 'normative',
    group: '1000003', // კანონი
    sort: 'signingDate_desc',
    limit: '100',
  },
  'full-main-normative': {
    type: 'main',
    additional_status: 'normative',
    sort: 'signingDate_desc',
    limit: '100',
  },
};

function parsePositiveInt(value: string, argName: string): number {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid value for ${argName}: ${value}`);
  }
  return parsed;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    mode: 'curated',
    limit: null,
    maxPages: null,
    clean: true,
    resume: false,
    skipEnglish: false,
    quiet: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--mode' && args[i + 1]) {
      const mode = args[++i] as IngestionMode;
      if (!['curated', 'full-laws', 'full-main-normative'].includes(mode)) {
        throw new Error(`Unsupported mode: ${mode}`);
      }
      options.mode = mode;
      continue;
    }

    if (arg === '--limit' && args[i + 1]) {
      options.limit = parsePositiveInt(args[++i], '--limit');
      continue;
    }

    if (arg === '--max-pages' && args[i + 1]) {
      options.maxPages = parsePositiveInt(args[++i], '--max-pages');
      continue;
    }

    if (arg === '--no-clean') {
      options.clean = false;
      continue;
    }

    if (arg === '--resume') {
      options.resume = true;
      options.clean = false;
      continue;
    }

    if (arg === '--skip-english') {
      options.skipEnglish = true;
      continue;
    }

    if (arg === '--quiet') {
      options.quiet = true;
      continue;
    }
  }

  return options;
}

function extractDocumentIds(html: string): number[] {
  const ids = [...html.matchAll(/\/ka\/document\/view\/(\d+)/g)].map(m => Number(m[1]));
  return Array.from(new Set(ids)).filter(Number.isFinite);
}

function parseSearchTotalResults(html: string): number | undefined {
  const match = html.match(/სულ მოიძებნა:\s*([0-9,]+)/);
  if (!match) return undefined;

  const value = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(value) ? value : undefined;
}

function parseSearchLastPage(html: string): number {
  const lastMatch = html.match(/page=([0-9]+)">ბოლო/);
  if (lastMatch) {
    return Number(lastMatch[1]);
  }

  const pageNums = [...html.matchAll(/data-pagenumber="(\d+)"/g)]
    .map(m => Number(m[1]))
    .filter(Number.isFinite);

  if (pageNums.length === 0) return 1;
  return Math.max(...pageNums);
}

function buildSearchUrl(params: Record<string, string>): string {
  const url = new URL(SEARCH_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== '') {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
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

function buildSeedPath(seedId: string): string {
  return path.join(SEED_DIR, `${seedId}.json`);
}

function writeSeed(seed: ParsedAct): void {
  fs.writeFileSync(buildSeedPath(seed.id), `${JSON.stringify(seed, null, 2)}\n`);
}

function extractDocDownloadPath(html: string, documentId: number): string | undefined {
  const directPattern = new RegExp(`/ka/document/download/${documentId}/\\d+/ge/doc`, 'i');
  const directMatch = html.match(directPattern);
  if (directMatch) return directMatch[0];

  const genericMatch = html.match(/\/ka\/document\/download\/\d+\/\d+\/ge\/doc/i);
  if (genericMatch) return genericMatch[0];

  return undefined;
}

function convertDocBufferToText(buffer: Buffer, documentId: number): string | undefined {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `matsne-doc-${documentId}-`));
  const docPath = path.join(tmpDir, `${documentId}.doc`);
  const txtPath = path.join(tmpDir, `${documentId}.txt`);

  try {
    fs.writeFileSync(docPath, buffer);

    const result = spawnSync(
      'soffice',
      ['--headless', '--convert-to', 'txt:Text', '--outdir', tmpDir, docPath],
      {
        encoding: 'utf8',
        timeout: DOC_CONVERSION_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      }
    );

    if (result.error) {
      return undefined;
    }

    if (result.status !== 0 || !fs.existsSync(txtPath)) {
      return undefined;
    }

    const text = fs.readFileSync(txtPath, 'utf8');
    return text.replace(/\uFEFF/g, '').replace(/\r/g, '');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function parseDocDownloadProvisions(
  html: string,
  documentId: number
): Promise<ReturnType<typeof parseMatsneProvisions>> {
  const downloadPath = extractDocDownloadPath(html, documentId);
  if (!downloadPath) {
    return { provisions: [], definitions: [] };
  }

  const downloadUrl = new URL(downloadPath, MATSNE_BASE).toString();
  const response = await fetchBinaryWithRateLimit(downloadUrl);
  if (response.blocked || response.status !== 200) {
    return { provisions: [], definitions: [] };
  }

  if (!/application\/msword/i.test(response.contentType)) {
    return { provisions: [], definitions: [] };
  }

  const text = convertDocBufferToText(response.body, documentId);
  if (!text || text.trim().length < 100) {
    return { provisions: [], definitions: [] };
  }

  return parseMatsneProvisionsFromPlainText(text);
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

async function fetchSearchDocumentIds(
  params: Record<string, string>,
  maxPages: number | null,
  quiet: boolean
): Promise<{ ids: number[]; totalResults?: number; pagesFetched: number; lastPage: number }> {
  const seen = new Set<number>();

  let totalResults: number | undefined;
  let lastPage = 1;
  let pagesFetched = 0;
  let page = 1;

  while (true) {
    const pageParams: Record<string, string> = { ...params };
    if (page > 1) pageParams.page = String(page);

    const url = buildSearchUrl(pageParams);
    const response = await fetchWithRateLimit(url);

    if (response.blocked) {
      throw new Error(
        `Search page blocked (page ${page})${response.blockReferenceId ? `, Ref ID ${response.blockReferenceId}` : ''}`
      );
    }
    if (response.status !== 200) {
      throw new Error(`Search page HTTP ${response.status} (page ${page})`);
    }

    pagesFetched++;

    const pageIds = extractDocumentIds(response.body);
    for (const id of pageIds) seen.add(id);

    if (page === 1) {
      totalResults = parseSearchTotalResults(response.body);
      lastPage = parseSearchLastPage(response.body);
      if (!quiet) {
        console.log(
          `Search profile discovered ${totalResults ?? 'unknown'} results across ${lastPage} page(s).`
        );
      }
    }

    if (!quiet && (page === 1 || page === lastPage || page % 25 === 0)) {
      console.log(`  Search page ${page}/${lastPage}: ${seen.size} unique IDs collected`);
    }

    if (maxPages !== null && pagesFetched >= maxPages) break;
    if (page >= lastPage) break;

    page++;
  }

  return {
    ids: Array.from(seen).sort((a, b) => a - b),
    totalResults,
    pagesFetched,
    lastPage,
  };
}

async function discoverCandidateIds(
  options: CliOptions
): Promise<{ ids: number[]; summary: DiscoverySummary }> {
  if (options.mode === 'curated') {
    const listingIds = await fetchListingDocumentIds();
    const ids = Array.from(new Set([...listingIds, ...EXTRA_DOCUMENT_IDS])).sort((a, b) => a - b);

    return {
      ids,
      summary: {
        strategy: 'curated',
        listing_urls: LISTING_URLS,
        discovered_listing_ids: listingIds.length,
      },
    };
  }

  const searchParams = SEARCH_PROFILES[options.mode];
  const discovery = await fetchSearchDocumentIds(searchParams, options.maxPages, options.quiet);

  return {
    ids: discovery.ids,
    summary: {
      strategy: 'search',
      search_profile: options.mode,
      search_params: searchParams,
      search_total_results: discovery.totalResults,
      search_pages_fetched: discovery.pagesFetched,
      search_last_page: discovery.lastPage,
    },
  };
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

async function ingestDocument(
  documentId: number,
  options: Pick<CliOptions, 'skipEnglish'>
): Promise<{ result: IngestResult; seed?: ParsedAct }> {
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

  let parsed = parseMatsneProvisions(pageResponse.body);
  if (parsed.provisions.length === 0) {
    parsed = await parseDocDownloadProvisions(pageResponse.body, documentId);
  }

  if (parsed.provisions.length === 0) {
    return {
      result: {
        documentId,
        status: 'skipped',
        reason: 'no provisions parsed',
      },
    };
  }

  const titleEn =
    !options.skipEnglish && meta.hasEnglishVersion
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
  const options = parseArgs();

  console.log('Georgian Law MCP -- Real Matsne ingestion');
  console.log('=========================================');
  console.log(`Mode: ${options.mode}`);
  if (options.limit) console.log(`Limit: ${options.limit}`);
  if (options.maxPages) console.log(`Max pages: ${options.maxPages}`);
  if (options.resume) console.log('Resume mode: enabled (existing seed files are reused)');
  if (options.skipEnglish) console.log('English titles: skipped (--skip-english)');
  console.log('');

  const discovery = await discoverCandidateIds(options);
  const selectedIds = options.limit ? discovery.ids.slice(0, options.limit) : discovery.ids;

  if (discovery.summary.strategy === 'curated') {
    console.log(
      `Discovered ${discovery.summary.discovered_listing_ids} listing IDs; ingesting ${selectedIds.length} documents.`
    );
  } else {
    console.log(
      `Search-discovered ${discovery.ids.length} document IDs; ingesting ${selectedIds.length} documents.`
    );
  }
  console.log('');

  if (options.clean) {
    cleanSeedDir();
  } else {
    fs.mkdirSync(SEED_DIR, { recursive: true });
  }

  const results: IngestResult[] = [];
  const total = selectedIds.length;
  const width = String(total).length;

  for (let i = 0; i < total; i++) {
    const id = selectedIds[i];
    const indexLabel = `[${String(i + 1).padStart(width, '0')}/${total}]`;

    const expectedSeedId = makeDocumentSeedId(id);
    if (options.resume && fs.existsSync(buildSeedPath(expectedSeedId))) {
      results.push({
        documentId: id,
        status: 'already_present',
        seedId: expectedSeedId,
      });

      if (!options.quiet) {
        console.log(`${indexLabel} ${id} ... SKIP (already present)`);
      }
      continue;
    }

    if (!options.quiet) {
      process.stdout.write(`${indexLabel} ${id} ... `);
    }

    try {
      const { result, seed } = await ingestDocument(id, options);
      results.push(result);

      if (seed) {
        writeSeed(seed);
        if (!options.quiet) {
          console.log(`OK (${seed.provisions.length} provisions, ${seed.definitions.length} definitions)`);
        }
      } else if (!options.quiet) {
        console.log(`SKIP (${result.reason})`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ documentId: id, status: 'skipped', reason: message });

      if (!options.quiet) {
        console.log(`SKIP (${message})`);
      }
    }

    if (options.quiet && ((i + 1) % 25 === 0 || i + 1 === total)) {
      const ingestedSoFar = results.filter(r => r.status === 'ingested').length;
      const skippedSoFar = results.filter(r => r.status === 'skipped').length;
      const reusedSoFar = results.filter(r => r.status === 'already_present').length;
      console.log(
        `${indexLabel} processed, ingested=${ingestedSoFar}, skipped=${skippedSoFar}, already_present=${reusedSoFar}`
      );
    }
  }

  const ingested = results.filter(r => r.status === 'ingested');
  const skipped = results.filter(r => r.status === 'skipped');
  const alreadyPresent = results.filter(r => r.status === 'already_present');

  const report = {
    generated_at: new Date().toISOString(),
    source: 'https://www.matsne.gov.ge',
    mode: options.mode,
    discovery: discovery.summary,
    selected_ids: selectedIds.length,
    ingested_documents: ingested.length,
    skipped_documents: skipped.length,
    already_present_documents: alreadyPresent.length,
    total_provisions: ingested.reduce((sum, r) => sum + (r.provisions ?? 0), 0),
    total_definitions: ingested.reduce((sum, r) => sum + (r.definitions ?? 0), 0),
    skipped_reasons: skipped,
  };

  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  console.log('\nIngestion summary');
  console.log('-----------------');
  console.log(`Ingested:        ${ingested.length}`);
  console.log(`Skipped:         ${skipped.length}`);
  console.log(`Already present: ${alreadyPresent.length}`);
  console.log(`Seed files:      ${fs.readdirSync(SEED_DIR).filter(f => f.endsWith('.json')).length}`);
  console.log(`Output:          ${SEED_DIR}`);
  console.log(`Report:          ${REPORT_PATH}`);
}

main().catch(error => {
  console.error('Fatal ingestion error:', error);
  process.exit(1);
});
