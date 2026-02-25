# Georgian Full-Main-Normative Ingestion Handover

Timestamp: 2026-02-25T14:56:34+01:00
Repository: `Ansvar-Systems/Georgian-law-mcp`
Branch: `dev`
Base HEAD before this handover commit: `9bc73ac`

## Stop Confirmation

- All `full-main-normative` ingestion processes were stopped before this handover.
- Process check at handover time returned no matching active `ingest.ts` process for:
  - `--mode full-main-normative --resume --skip-english --quiet`

## Current Corpus State

- Seed files present: `29,747` JSON files under `data/seed/`.
- `data/ingestion-report.json` is present but reflects the latest completed short run, not total historical progress.

## Latest Known Checkpoints (from logs)

1. `logs/full-main-normative-20260222-185204-kickstart-timeout.log`
   - Last checkpoint: `29,650 / 51,350`
   - Counters: `ingested=15,893`, `skipped=180`, `already_present=13,577`
   - Ended with Node OOM (heap exhaustion) after extensive progress.

2. `logs/full-main-normative-20260225-114307-heap12g-resume.log`
   - Last checkpoint: `16,625 / 51,359`
   - Counters: `ingested=0`, `skipped=38`, `already_present=16,587`
   - This run used larger heap and was then stopped per user request.

3. `logs/full-main-normative-20260222-070721-1s-delay.log`
   - Last checkpoint: `13,500 / 51,350`
   - Counters: `ingested=12,601`, `skipped=30`, `already_present=869`

Note: total discovered results changed between runs (`51,350` vs `51,359`), likely due portal-side updates.

## Code Changes Included in This Handover

- `scripts/lib/fetcher.ts`
  - Request pacing set to `1000ms` between requests (still within required 1-2s rate limit).

- `scripts/ingest.ts`
  - DOC download fallback support is present.
  - DOC->text conversion now has a hard timeout (`DOC_CONVERSION_TIMEOUT_MS = 180_000`) to prevent indefinite hangs.

- `scripts/check-full-main-progress.sh`
  - Helper script to inspect active log/process/seed count status.

## Recommended Resume Command

Use a larger heap and resume mode:

```bash
NODE_OPTIONS="--max-old-space-size=12288" npm run ingest -- --mode full-main-normative --resume --skip-english --quiet
```

Detached example:

```bash
log_file="logs/full-main-normative-$(date +%Y%m%d-%H%M%S)-resume.log"
setsid bash -lc 'cd /home/ansvar/Projects/mcps/law-mcps/Georgian-law-mcp && NODE_OPTIONS="--max-old-space-size=12288" npm run ingest -- --mode full-main-normative --resume --skip-english --quiet' > "$log_file" 2>&1 < /dev/null &
```

## Recommended Monitoring

```bash
tail -f logs/full-main-normative-*.log
find data/seed -maxdepth 1 -name '*.json' | wc -l
scripts/check-full-main-progress.sh <log_file> <node_pid> <npm_pid>
```

## Post-Completion Validation Checklist

After full completion:

```bash
npm run build:db
npm run build
npm test
npx tsc --noEmit
```

Then update final report and commit/push.
