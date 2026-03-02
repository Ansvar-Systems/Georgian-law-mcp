# Georgian Law MCP Server

**The matsne.gov.ge alternative for the AI age.**

[![npm version](https://badge.fury.io/js/@ansvar%2Fgeorgian-law-mcp.svg)](https://www.npmjs.com/package/@ansvar/georgian-law-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP-Registry-blue)](https://registry.modelcontextprotocol.io)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![GitHub stars](https://img.shields.io/github/stars/Ansvar-Systems/Georgian-law-mcp?style=social)](https://github.com/Ansvar-Systems/Georgian-law-mcp)
[![CI](https://github.com/Ansvar-Systems/Georgian-law-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Ansvar-Systems/Georgian-law-mcp/actions/workflows/ci.yml)
[![Daily Data Check](https://github.com/Ansvar-Systems/Georgian-law-mcp/actions/workflows/check-updates.yml/badge.svg)](https://github.com/Ansvar-Systems/Georgian-law-mcp/actions/workflows/check-updates.yml)
[![Database](https://img.shields.io/badge/database-pre--built-green)](https://github.com/Ansvar-Systems/Georgian-law-mcp)
[![Provisions](https://img.shields.io/badge/provisions-35%2C463-blue)](https://github.com/Ansvar-Systems/Georgian-law-mcp)

Query **943 Georgian statutes** -- from პერსონალური მონაცემების დაცვის შესახებ კანონი and სისხლის სამართლის კოდექსი to სამოქალაქო კოდექსი, ადმინისტრაციული კოდექსი, and more -- directly from Claude, Cursor, or any MCP-compatible client.

If you're building legal tech, compliance tools, or doing Georgian legal research, this is your verified reference database.

Built by [Ansvar Systems](https://ansvar.eu) -- Stockholm, Sweden

---

## Why This Exists

Georgian legal research means navigating matsne.gov.ge (ლეგისლაციის ეროვნული ცენტრი), Georgia's National Legislative Herald, across hundreds of statutes with frequent amendments driven by Georgia's EU approximation process. Whether you're:

- A **lawyer** validating citations in a brief or contract
- A **compliance officer** checking Georgian data protection or cybersecurity obligations
- A **legal tech developer** building tools on Georgian law
- A **researcher** tracking legislative alignment with EU law under the Association Agreement

...you shouldn't need dozens of browser tabs and manual cross-referencing. Ask Claude. Get the exact provision. With context.

This MCP server makes Georgian law **searchable, cross-referenceable, and AI-readable**.

---

## Quick Start

### Use Remotely (No Install Needed)

> Connect directly to the hosted version -- zero dependencies, nothing to install.

**Endpoint:** `https://georgian-law-mcp.vercel.app/mcp`

| Client | How to Connect |
|--------|---------------|
| **Claude.ai** | Settings > Connectors > Add Integration > paste URL |
| **Claude Code** | `claude mcp add georgian-law --transport http https://georgian-law-mcp.vercel.app/mcp` |
| **Claude Desktop** | Add to config (see below) |
| **GitHub Copilot** | Add to VS Code settings (see below) |

**Claude Desktop** -- add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "georgian-law": {
      "type": "url",
      "url": "https://georgian-law-mcp.vercel.app/mcp"
    }
  }
}
```

**GitHub Copilot** -- add to VS Code `settings.json`:

```json
{
  "github.copilot.chat.mcp.servers": {
    "georgian-law": {
      "type": "http",
      "url": "https://georgian-law-mcp.vercel.app/mcp"
    }
  }
}
```

### Use Locally (npm)

```bash
npx @ansvar/georgian-law-mcp
```

**Claude Desktop** -- add to `claude_desktop_config.json`:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "georgian-law": {
      "command": "npx",
      "args": ["-y", "@ansvar/georgian-law-mcp"]
    }
  }
}
```

**Cursor / VS Code:**

```json
{
  "mcp.servers": {
    "georgian-law": {
      "command": "npx",
      "args": ["-y", "@ansvar/georgian-law-mcp"]
    }
  }
}
```

---

## Example Queries

Once connected, just ask naturally:

- *"ძიება 'პერსონალური მონაცემების' დებულებებზე ქართულ კანონმდებლობაში"*
- *"რას ამბობს სისხლის სამართლის კოდექსი კიბერდანაშაულის შესახებ?"*
- *"იპოვე სამოქალაქო კოდექსის დებულებები ზიანის ანაზღაურების შესახებ"*
- *"რომელი კანონები არეგულირებს ელექტრონულ კომერციას საქართველოში?"*
- *"პერსონალური მონაცემების დაცვის შესახებ კანონი კვლავ მოქმედია?"*
- *"Search for provisions about personal data breach notification in Georgian law"*
- *"What EU directives does Georgia's data protection law align with?"*
- *"Validate the citation 'მუხლი 5, პერსონალური მონაცემების დაცვის შესახებ კანონი'"*

---

## What's Included

| Category | Count | Details |
|----------|-------|---------|
| **Statutes** | 943 statutes | Core Georgian legislation from matsne.gov.ge |
| **Provisions** | 35,463 sections | Full-text searchable with FTS5 |
| **Legal Definitions** | 0 (free tier) | Table reserved, extraction not enabled in current free build |
| **Database Size** | Optimized SQLite | Portable, pre-built |
| **Daily Updates** | Automated | Freshness checks against ლეგისლაციის ეროვნული ცენტრი |

**Verified data only** -- every citation is validated against official sources (matsne.gov.ge). Zero LLM-generated content.

---

## See It In Action

### Why This Works

**Verbatim Source Text (No LLM Processing):**
- All statute text is ingested from matsne.gov.ge (ლეგისლაციის ეროვნული ცენტრი) official sources
- Provisions are returned **unchanged** from SQLite FTS5 database rows
- Zero LLM summarization or paraphrasing -- the database contains regulation text, not AI interpretations

**Smart Context Management:**
- Search returns ranked provisions with BM25 scoring (safe for context)
- Provision retrieval gives exact text by statute identifier + chapter/section
- Cross-references help navigate without loading everything at once

**Technical Architecture:**
```
matsne.gov.ge --> Parse --> SQLite --> FTS5 snippet() --> MCP response
                   ^                        ^
            Provision parser         Verbatim database query
```

### Traditional Research vs. This MCP

| Traditional Approach | This MCP Server |
|---------------------|-----------------|
| Search matsne.gov.ge by statute number | Search by plain Georgian: *"პერსონალური მონაცემები თანხმობა"* |
| Navigate multi-chapter statutes manually | Get the exact provision with context |
| Manual cross-referencing between laws | `build_legal_stance` aggregates across sources |
| "Is this statute still in force?" -- check manually | `check_currency` tool -- answer in seconds |
| Find EU alignment -- dig through EUR-Lex | `get_eu_basis` -- linked EU directives instantly |
| No API, no integration | MCP protocol -- AI-native |

**Traditional:** Search matsne.gov.ge --> Navigate Georgian-language pages --> Ctrl+F --> Cross-reference with related statutes --> Check EUR-Lex for EU basis --> Repeat

**This MCP:** *"რა მოთხოვნებია პერსონალური მონაცემების დაცვაზე საქართველოში და როგორ შეესაბამება ის GDPR-ს?"* -- Done.

---

## Available Tools (13)

### Core Legal Research Tools (8)

| Tool | Description |
|------|-------------|
| `search_legislation` | FTS5 full-text search across 35,463 provisions with BM25 ranking. Supports Georgian and English queries |
| `get_provision` | Retrieve specific provision by statute identifier + chapter/section |
| `check_currency` | Check if a statute is in force, amended, or repealed |
| `validate_citation` | Validate citation against database -- zero-hallucination check |
| `build_legal_stance` | Aggregate citations from multiple statutes for a legal topic |
| `format_citation` | Format citations per Georgian conventions |
| `list_sources` | List all available statutes with metadata, coverage scope, and data provenance |
| `about` | Server info, capabilities, dataset statistics, and coverage summary |

### EU/International Law Integration Tools (5)

| Tool | Description |
|------|-------------|
| `get_eu_basis` | Get EU directives/regulations that a Georgian statute aligns with |
| `get_georgian_implementations` | Find Georgian laws implementing or aligning with an EU act |
| `search_eu_implementations` | Search EU documents with Georgian alignment counts |
| `get_provision_eu_basis` | Get EU law references for a specific provision |
| `validate_eu_compliance` | Check alignment status of Georgian statutes against EU requirements |

---

## EU Law Integration

Georgia has an EU Association Agreement (in force since 2016), which includes a Deep and Comprehensive Free Trade Area (DCFTA). Georgia is implementing extensive EU acquis approximation as part of this agreement, and applied for EU membership in March 2022.

Key alignment areas:

- **Data protection:** Georgia's Law on Personal Data Protection aligns with GDPR principles; the Personal Data Protection Service (PDPS) is an independent supervisory authority
- **Cybersecurity:** Georgian cybersecurity legislation is being aligned with EU standards
- **Financial services:** Alignment with EU financial services directives under the DCFTA
- **Competition law:** Ongoing alignment with EU competition framework
- **Consumer protection:** Alignment with EU consumer protection acquis

The EU bridge tools allow you to explore these alignment relationships -- checking which Georgian provisions correspond to EU requirements, and vice versa.

> **Note:** EU cross-references reflect alignment and approximation relationships under the Association Agreement, not full transposition. Georgia adopts its own legislative approach, and the EU tools help identify where Georgian and EU law address similar domains.

---

## Data Sources & Freshness

All content is sourced from authoritative Georgian legal databases:

- **[matsne.gov.ge](https://matsne.gov.ge/)** -- ლეგისლაციის ეროვნული ცენტრი (Legislative Herald of Georgia), official database of Georgian legislation

### Data Provenance

| Field | Value |
|-------|-------|
| **Authority** | ლეგისლაციის ეროვნული ცენტრი (National Legislative Herald of Georgia) |
| **Retrieval method** | Structured data from matsne.gov.ge |
| **Languages** | Georgian (primary) |
| **License** | Public domain (Georgian government official publications) |
| **Coverage** | 943 statutes across all legislative domains |

### Automated Freshness Checks (Daily)

A [daily GitHub Actions workflow](.github/workflows/check-updates.yml) monitors all data sources:

| Source | Check | Method |
|--------|-------|--------|
| **Statute amendments** | matsne.gov.ge date comparison | All statutes checked |
| **New statutes** | Legislative Herald publications | Diffed against database |
| **Repealed statutes** | Status change detection | Flagged automatically |

**Verified data only** -- every citation is validated against official sources. Zero LLM-generated content.

---

## Security

This project uses multiple layers of automated security scanning:

| Scanner | What It Does | Schedule |
|---------|-------------|----------|
| **CodeQL** | Static analysis for security vulnerabilities | Weekly + PRs |
| **Semgrep** | SAST scanning (OWASP top 10, secrets, TypeScript) | Every push |
| **Gitleaks** | Secret detection across git history | Every push |
| **Trivy** | CVE scanning on filesystem and npm dependencies | Daily |
| **Docker Security** | Container image scanning + SBOM generation | Daily |
| **Socket.dev** | Supply chain attack detection | PRs |
| **OSSF Scorecard** | OpenSSF best practices scoring | Weekly |
| **Dependabot** | Automated dependency updates | Weekly |

See [SECURITY.md](SECURITY.md) for the full policy and vulnerability reporting.

---

## Important Disclaimers

### Legal Advice

> **THIS TOOL IS NOT LEGAL ADVICE**
>
> Statute text is sourced from matsne.gov.ge (ლეგისლაციის ეროვნული ცენტრი). However:
> - This is a **research tool**, not a substitute for professional legal counsel
> - **Court case coverage is not included** -- do not rely solely on this for case law research
> - **Verify critical citations** against primary sources for court filings
> - **EU cross-references** reflect alignment under the Association Agreement, not full transposition
> - **Georgian law is changing** due to the ongoing EU approximation process -- verify currency for any provision you rely on professionally

**Before using professionally, read:** [DISCLAIMER.md](DISCLAIMER.md) | [PRIVACY.md](PRIVACY.md)

### Client Confidentiality

Queries go through the Claude API. For privileged or confidential matters, use on-premise deployment. See [PRIVACY.md](PRIVACY.md) for guidance compliant with საქართველოს ადვოკატთა ასოციაცია (Georgian Bar Association) professional responsibility rules.

---

## Documentation

- **[Security Policy](SECURITY.md)** -- Vulnerability reporting and scanning details
- **[Disclaimer](DISCLAIMER.md)** -- Legal disclaimers and professional use notices
- **[Privacy](PRIVACY.md)** -- Client confidentiality and data handling

---

## Development

### Setup

```bash
git clone https://github.com/Ansvar-Systems/Georgian-law-mcp
cd Georgian-law-mcp
npm install
npm run build
npm test
```

### Running Locally

```bash
npm run dev                                       # Start MCP server
npx @anthropic/mcp-inspector node dist/index.js   # Test with MCP Inspector
```

### Data Management

```bash
npm run ingest          # Ingest statutes from matsne.gov.ge
npm run build:db        # Rebuild SQLite database
npm run drift:detect    # Run drift detection against known anchors
npm run check-updates   # Check for source updates
```

### Performance

- **Search Speed:** <100ms for most FTS5 queries
- **Reliability:** 100% ingestion success rate

---

## Related Projects: Complete Compliance Suite

This server is part of **Ansvar's Compliance Suite** -- MCP servers that work together for end-to-end compliance coverage:

### [@ansvar/eu-regulations-mcp](https://github.com/Ansvar-Systems/EU_compliance_MCP)
**Query 49 EU regulations directly from Claude** -- GDPR, AI Act, DORA, NIS2, MiFID II, eIDAS, and more. Full regulatory text with article-level search. `npx @ansvar/eu-regulations-mcp`

### [@ansvar/georgian-law-mcp](https://github.com/Ansvar-Systems/Georgian-law-mcp) (This Project)
**Query 943 Georgian statutes directly from Claude** -- პერსონალური მონაცემების დაცვის შესახებ კანონი, სისხლის სამართლის კოდექსი, სამოქალაქო კოდექსი, and more. `npx @ansvar/georgian-law-mcp`

### [@ansvar/security-controls-mcp](https://github.com/Ansvar-Systems/security-controls-mcp)
**Query 261 security frameworks** -- ISO 27001, NIST CSF, SOC 2, CIS Controls, SCF, and more. `npx @ansvar/security-controls-mcp`

### [@ansvar/sanctions-mcp](https://github.com/Ansvar-Systems/Sanctions-MCP)
**Offline-capable sanctions screening** -- OFAC, EU, UN sanctions lists. `pip install ansvar-sanctions-mcp`

**100+ national law MCPs** covering Australia, Belgium, Brazil, Canada, Denmark, Finland, France, Germany, Ireland, Italy, Netherlands, Norway, Poland, Sweden, Switzerland, UK, and more.

---

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Priority areas:
- Court case law expansion (Georgian courts)
- EU Regulations MCP integration (full EU law text)
- Historical statute versions and amendment tracking
- English translations for key statutes

---

## Roadmap

- [x] Core statute database with FTS5 search
- [x] Full corpus ingestion (943 statutes, 35,463 provisions)
- [x] EU/international law alignment tools
- [x] Vercel Streamable HTTP deployment
- [x] npm package publication
- [x] Daily freshness checks
- [ ] Court case law expansion
- [ ] Historical statute versions (amendment tracking)
- [ ] English translations for key statutes
- [ ] EU accession approximation tracking

---

## Citation

If you use this MCP server in academic research:

```bibtex
@software{georgian_law_mcp_2026,
  author = {Ansvar Systems AB},
  title = {Georgian Law MCP Server: AI-Powered Legal Research Tool},
  year = {2026},
  url = {https://github.com/Ansvar-Systems/Georgian-law-mcp},
  note = {943 Georgian statutes with 35,463 provisions}
}
```

---

## License

Apache License 2.0. See [LICENSE](./LICENSE) for details.

### Data Licenses

- **Statutes & Legislation:** ლეგისლაციის ეროვნული ცენტრი / National Legislative Herald of Georgia (public domain, official government publications)
- **EU Metadata:** EUR-Lex (EU public domain)

---

## About Ansvar Systems

We build AI-accelerated compliance and legal research tools for the global market. This MCP server started as our internal reference tool for Georgian law -- turns out everyone building compliance tools for businesses operating in Georgia has the same research frustrations.

So we're open-sourcing it. Navigating 943 statutes in Georgian script shouldn't require 47 browser tabs.

**[ansvar.eu](https://ansvar.eu)** -- Stockholm, Sweden

---

<p align="center">
  <sub>Built with care in Stockholm, Sweden</sub>
</p>
