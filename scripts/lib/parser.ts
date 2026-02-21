/**
 * HTML parser for Matsne (Legislative Herald of Georgia).
 *
 * Parsing strategy:
 * - Use page metadata (`og:title`, publication links, language switch links)
 * - Parse legal text from the consolidated `#maindoc` block
 * - Extract article headings from `p.muxlixml` ("მუხლი ...")
 * - Accumulate following paragraph classes as the article body
 */

export interface MatsneDocumentMetadata {
  documentId: number;
  title: string;
  issuedDate?: string;
  authority?: string;
  registrationCode?: string;
  latestPublicationId?: number;
  hasEnglishVersion: boolean;
  canonicalUrl?: string;
}

export interface ParsedProvision {
  provision_ref: string;
  chapter?: string;
  section: string;
  title: string;
  content: string;
}

export interface ParsedDefinition {
  term: string;
  definition: string;
  source_provision?: string;
}

export interface ParsedAct {
  id: string;
  type: 'statute';
  title: string;
  title_en?: string;
  short_name: string;
  status: 'in_force' | 'amended' | 'repealed' | 'not_yet_in_force';
  issued_date?: string;
  in_force_date?: string;
  url: string;
  description?: string;
  provisions: ParsedProvision[];
  definitions: ParsedDefinition[];
}

const HEADING_CLASSES = new Set([
  'mimgebixml',
  'sataurixml',
  'satauri2',
  'tavixml',
  'tavisataurixml',
  'karixml',
  'zogadinacilixml',
  'gansakutrebulinacilixml',
  'muxlixml',
  'danartixml',
]);

const CONTENT_CLASSES = new Set([
  'abzacixml',
  'punqtxml',
  'qvepunqtxml',
  'ckhrilixml',
  'textbody',
  'msonormal',
  'msoplaintext',
]);

function decodeHtmlEntities(text: string): string {
  const named: Record<string, string> = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&mdash;': '—',
    '&ndash;': '–',
    '&minus;': '-',
    '&bdquo;': '„',
    '&ldquo;': '“',
    '&rdquo;': '”',
    '&laquo;': '«',
    '&raquo;': '»',
  };

  let decoded = text;
  for (const [entity, value] of Object.entries(named)) {
    decoded = decoded.split(entity).join(value);
  }

  decoded = decoded.replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
    String.fromCodePoint(parseInt(hex, 16))
  );
  decoded = decoded.replace(/&#([0-9]+);/g, (_, num: string) =>
    String.fromCodePoint(parseInt(num, 10))
  );

  return decoded;
}

function convertSupToCaret(html: string): string {
  return html.replace(/<sup[^>]*>\s*([^<]+?)\s*<\/sup>/gi, '^$1');
}

function htmlToPlain(html: string): string {
  const stripped = convertSupToCaret(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\u00a0/g, ' ');

  return decodeHtmlEntities(stripped)
    .replace(/\r/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeSection(section: string): string {
  return section
    .replace(/\s+/g, '')
    .replace(/\^\^+/g, '^')
    .replace(/^\^+/, '')
    .replace(/\^+$/, '');
}

function sectionToProvisionRef(section: string): string {
  const normalized = normalizeSection(section).replace(/\^/g, '_');
  return `art${normalized}`;
}

function extractArticleSection(heading: string): string | null {
  const match = heading.match(/^მუხლი\s+([0-9]+(?:\s*(?:\^|\s)\s*[0-9]+)*)\s*(?:[.)]|$)/i);
  if (!match) return null;

  const numbers = match[1].match(/[0-9]+/g);
  if (!numbers || numbers.length === 0) return null;
  return normalizeSection(numbers.join('^'));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractBalancedTableById(html: string, tableId: string): string | undefined {
  const tableStartRegex = new RegExp(`<table\\b[^>]*\\bid=['"]${escapeRegExp(tableId)}['"][^>]*>`, 'i');
  const startMatch = tableStartRegex.exec(html);
  if (!startMatch) return undefined;

  const start = startMatch.index;
  const tableTagRegex = /<\/?table\b[^>]*>/gi;
  tableTagRegex.lastIndex = start;

  let depth = 0;
  let tag: RegExpExecArray | null;
  while ((tag = tableTagRegex.exec(html)) !== null) {
    if (/^<table\b/i.test(tag[0])) {
      depth++;
    } else {
      depth--;
      if (depth === 0) {
        return html.slice(start, tableTagRegex.lastIndex);
      }
    }
  }

  return undefined;
}

function parseTableBasedProvisions(maindoc: string): {
  provisions: ParsedProvision[];
  definitions: ParsedDefinition[];
} {
  const provisions: ParsedProvision[] = [];
  const definitions: ParsedDefinition[] = [];
  const baseProvisionRefCounts = new Map<string, number>();

  let currentChapter: string | undefined;
  const anchorRegex = /<a\b[^>]*\bname=['"]([^'"]+)['"][^>]*>\s*<\/a>/gi;
  let anchorMatch: RegExpExecArray | null;

  while ((anchorMatch = anchorRegex.exec(maindoc)) !== null) {
    const anchorId = anchorMatch[1];
    const isArticleAnchor = /(?:^|;)ARTICLE:[0-9]+/i.test(anchorId);

    const titleTable = extractBalancedTableById(maindoc, `${anchorId}_Title`);
    const contentTable = extractBalancedTableById(maindoc, `${anchorId}_Content`);
    const titleText = titleTable ? htmlToPlain(titleTable).replace(/\s+/g, ' ').trim() : '';

    if (!isArticleAnchor && /(?:^|;)(?:BOOK|PART|CHAPTER|SECTION|TITLE):/i.test(anchorId)) {
      if (titleText) currentChapter = titleText;
      continue;
    }

    if (!isArticleAnchor) continue;
    if (!titleText) continue;

    const heading =
      titleText
        .split('\n')
        .map(line => line.replace(/\s+/g, ' ').trim())
        .find(line => /^მუხლი\b/i.test(line)) ??
      titleText.match(/მუხლი[\s\S]*$/i)?.[0]?.replace(/\s+/g, ' ').trim();

    if (!heading) continue;

    const section = extractArticleSection(heading);
    if (!section) continue;

    const baseProvisionRef = sectionToProvisionRef(section);
    const currentCount = baseProvisionRefCounts.get(baseProvisionRef) ?? 0;
    const provisionRef =
      currentCount === 0 ? baseProvisionRef : `${baseProvisionRef}_dup${currentCount + 1}`;
    baseProvisionRefCounts.set(baseProvisionRef, currentCount + 1);

    const content = contentTable ? htmlToPlain(contentTable) : '';
    if (!content) continue;

    provisions.push({
      provision_ref: provisionRef,
      chapter: currentChapter,
      section,
      title: heading,
      content,
    });

    if (/ტერმინ|განმარტებ/i.test(heading)) {
      for (const def of extractDefinitions(content, provisionRef)) {
        definitions.push(def);
      }
    }
  }

  return { provisions, definitions };
}

function extractMaidocHtml(html: string): string {
  const start = html.indexOf('<div class="document" id="maindoc">');
  if (start === -1) return html;

  const end = html.indexOf('</body>', start);
  if (end === -1) return html.slice(start);

  return html.slice(start, end);
}

export function parseMatsneMetadata(html: string, documentId: number): MatsneDocumentMetadata {
  const title =
    html.match(/<meta property="og:title" content="([^"]+)"/i)?.[1]?.trim() ?? `Document ${documentId}`;

  const issuedDateRaw =
    html.match(/title="მიღების თარიღი">([^<]+)<\/div>/i)?.[1]?.trim() ??
    html.match(/title="Дата принятия">([^<]+)<\/div>/i)?.[1]?.trim();
  let issuedDate: string | undefined;
  if (issuedDateRaw && /^\d{2}\/\d{2}\/\d{4}$/.test(issuedDateRaw)) {
    const [dd, mm, yyyy] = issuedDateRaw.split('/');
    issuedDate = `${yyyy}-${mm}-${dd}`;
  }

  const authority = html.match(/title="დოკუმენტის მიმღები">([^<]+)<\/div>/i)?.[1]?.trim();
  const registrationCode = html.match(/title="სარეგისტრაციო კოდი">([^<]+)<\/div>/i)?.[1]?.trim();
  const canonicalUrl = html.match(/<link rel="canonical" href="([^"]+)"/i)?.[1];

  const publicationIds = [...html.matchAll(/\?publication=(\d+)/g)].map(m => Number(m[1]));
  const latestPublicationId = publicationIds.length > 0 ? Math.max(...publicationIds) : undefined;

  const hasEnglishVersion = /matsne-language-switcher[\s\S]*value="en"/i.test(html);

  return {
    documentId,
    title: decodeHtmlEntities(title),
    issuedDate,
    authority: authority ? decodeHtmlEntities(authority) : undefined,
    registrationCode,
    latestPublicationId,
    hasEnglishVersion,
    canonicalUrl,
  };
}

export function parseMatsneEnglishTitle(html: string): string | undefined {
  if (/Access Denied|Oops! Something went wrong/i.test(html)) return undefined;

  const title = html.match(/<meta property="og:title" content="([^"]+)"/i)?.[1]?.trim();
  if (!title) return undefined;
  return decodeHtmlEntities(title);
}

export function parseMatsneProvisions(html: string): {
  provisions: ParsedProvision[];
  definitions: ParsedDefinition[];
} {
  const maindoc = extractMaidocHtml(html);
  const paragraphRegex = /<p([^>]*)>([\s\S]*?)<\/p>/gi;

  const provisions: ParsedProvision[] = [];
  const definitions: ParsedDefinition[] = [];
  const baseProvisionRefCounts = new Map<string, number>();

  let currentChapter: string | undefined;
  let currentProvision:
    | {
        section: string;
        title: string;
        chapter?: string;
        contentParts: string[];
      }
    | null = null;

  const finishProvision = (): void => {
    if (!currentProvision) return;

    const content = currentProvision.contentParts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (content.length > 0) {
      const section = normalizeSection(currentProvision.section);
      const baseProvisionRef = sectionToProvisionRef(section);
      const currentCount = baseProvisionRefCounts.get(baseProvisionRef) ?? 0;
      const provisionRef =
        currentCount === 0 ? baseProvisionRef : `${baseProvisionRef}_dup${currentCount + 1}`;
      baseProvisionRefCounts.set(baseProvisionRef, currentCount + 1);
      provisions.push({
        provision_ref: provisionRef,
        chapter: currentProvision.chapter,
        section,
        title: currentProvision.title,
        content,
      });

      // Definition extraction is intentionally conservative to avoid noisy synthetic terms.
      if (/ტერმინ|განმარტებ/i.test(currentProvision.title)) {
        for (const def of extractDefinitions(content, provisionRef)) {
          definitions.push(def);
        }
      }
    }

    currentProvision = null;
  };

  let match: RegExpExecArray | null;
  while ((match = paragraphRegex.exec(maindoc)) !== null) {
    const attrs = match[1] ?? '';
    const classNameRaw = attrs.match(/\bclass="([^"]+)"/i)?.[1] ?? '';
    const classTokens = classNameRaw
      .toLowerCase()
      .split(/\s+/)
      .map(c => c.trim())
      .filter(Boolean);
    const innerHtml = match[2];
    const text = htmlToPlain(innerHtml);

    if (!text) continue;

    const heading = text.replace(/\s+/g, ' ').trim();
    const section = extractArticleSection(heading);
    if (section) {
      finishProvision();

      currentProvision = {
        section,
        title: heading,
        chapter: currentChapter,
        contentParts: [],
      };
      continue;
    }

    if (
      classTokens.some(c => c.includes('tavixml') || c.includes('karixml') || c.includes('tavisataurixml')) ||
      /^თავი\b/i.test(text) ||
      /^კარი\b/i.test(text)
    ) {
      currentChapter = text.replace(/\s+/g, ' ').trim();
      continue;
    }

    if (!currentProvision) continue;

    const isBodyParagraph =
      classTokens.some(c => CONTENT_CLASSES.has(c)) ||
      (classTokens.length === 0 && text.length > 0) ||
      classTokens.some(c => !HEADING_CLASSES.has(c) && c.endsWith('xml'));

    if (!isBodyParagraph) continue;

    currentProvision.contentParts.push(text);
  }

  finishProvision();

  if (provisions.length === 0) {
    const tableBased = parseTableBasedProvisions(maindoc);
    if (tableBased.provisions.length > 0) {
      return tableBased;
    }
  }

  return { provisions, definitions };
}

function extractDefinitions(content: string, sourceProvision: string): ParsedDefinition[] {
  const defs: ParsedDefinition[] = [];

  const seen = new Set<string>();
  const pushDef = (term: string, definition: string): void => {
    const t = term.trim();
    const d = definition.trim();
    if (t.length < 2 || d.length < 8 || t.length > 120 || d.length > 2000) return;

    const key = `${t}::${d}`;
    if (seen.has(key)) return;
    seen.add(key);
    defs.push({ term: t, definition: d, source_provision: sourceProvision });
  };

  // Example: „ტერმინი“ - განმარტება
  const quotedPattern = /[„«]([^“»]+)[“»]\s*[-–—]\s*([^;\n]+(?:;|$))/g;
  let qMatch: RegExpExecArray | null;
  while ((qMatch = quotedPattern.exec(content)) !== null) {
    pushDef(qMatch[1], qMatch[2].replace(/[;.]$/, '').trim());
  }

  // Example: ა) ტერმინი - განმარტება
  const linePattern = /(?:^|\n)\s*[ა-ჰA-Za-z0-9]+[\)\.]?\s+([^-\n]{2,120})\s*[-–—]\s*([^\n]{8,})/g;
  let lMatch: RegExpExecArray | null;
  while ((lMatch = linePattern.exec(content)) !== null) {
    pushDef(lMatch[1], lMatch[2].replace(/[;.]$/, '').trim());
  }

  return defs;
}
