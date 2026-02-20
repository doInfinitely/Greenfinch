#!/bin/bash
BASE_URL="http://localhost:5000/api/admin/test-batch"
AUTH="Authorization: Bearer greenfinch-batch-test-2026"
LOG_FILE="/tmp/batch-test-50.log"
POLL_INTERVAL=15

echo "" > "$LOG_FILE"

log() {
  local msg="$(date -u '+%Y-%m-%dT%H:%M:%SZ') $1"
  echo "$msg"
  echo "$msg" >> "$LOG_FILE"
}

log "========================================================================"
log "Starting 50-property batch enrichment test"
log "========================================================================"

# Cancel any stale batch first
log "Cancelling any existing batch..."
curl -s -X DELETE "$BASE_URL" -H "$AUTH" -H "Content-Type: application/json" >> "$LOG_FILE" 2>&1
echo "" >> "$LOG_FILE"
sleep 2

# Start the batch
log "Starting batch (50 properties, concurrency 10)..."
START_RESPONSE=$(curl -s -X POST "$BASE_URL" \
  -H "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{"limit": 50, "concurrency": 10, "onlyUnenriched": true, "cancelFirst": true}')

log "Start response: $START_RESPONSE"

# Check if started successfully
SUCCESS=$(echo "$START_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',''))" 2>/dev/null)
if [ "$SUCCESS" != "True" ]; then
  log "ERROR: Failed to start batch"
  exit 1
fi

log "Batch started. Polling every ${POLL_INTERVAL}s..."
log "------------------------------------------------------------------------"

# Poll until complete
while true; do
  sleep "$POLL_INTERVAL"
  
  RESPONSE=$(curl -s "$BASE_URL" -H "$AUTH")
  
  STATUS=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null)
  PROCESSED=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); p=d.get('progress',{}); print(f\"{p.get('processed',0)}/{p.get('total',0)}\")" 2>/dev/null)
  SUCCEEDED=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('progress',{}).get('succeeded',0))" 2>/dev/null)
  FAILED=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('progress',{}).get('failed',0))" 2>/dev/null)
  PCT=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('percentComplete',0))" 2>/dev/null)
  
  log "Status: $STATUS | ${PCT}% ($PROCESSED) | OK: $SUCCEEDED | FAIL: $FAILED"
  
  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then
    break
  fi
done

log "------------------------------------------------------------------------"
log "FINAL REPORT"
log "------------------------------------------------------------------------"

# Get final status and pretty print
FINAL=$(curl -s "$BASE_URL" -H "$AUTH")
echo "$FINAL" | python3 -c "
import sys, json
d = json.load(sys.stdin)
p = d.get('progress', {})
s = d.get('summary', {})

print(f\"Status: {d.get('status')}\")
print(f\"Processed: {p.get('processed')}/{p.get('total')}\")
print(f\"Succeeded: {p.get('succeeded')}\")
print(f\"Failed: {p.get('failed')}\")
total = p.get('total', 0)
if total > 0:
    print(f\"Success rate: {round(p.get('succeeded',0)/total*100)}%\")
print(f\"Rate: {p.get('propertiesPerMinute', 'N/A')}/min\")

if s.get('stageBreakdown'):
    print(f\"\nFailure breakdown by stage:\")
    for k,v in s['stageBreakdown'].items():
        print(f\"  {k}: {v}\")

if s.get('serviceBreakdown'):
    print(f\"\nFailure breakdown by service:\")
    for k,v in s['serviceBreakdown'].items():
        print(f\"  {k}: {v}\")

print(f\"\nRetryable: {s.get('retryableCount',0)} | Permanent: {s.get('permanentCount',0)}\")

cb = d.get('circuitBreakers', {})
if cb:
    print(f\"\nCircuit breakers:\")
    for name, info in cb.items():
        print(f\"  {name}: {info.get('state')} (pending: {info.get('pending')})\")

errors = d.get('errors', [])
if errors:
    print(f\"\nAll errors ({len(errors)}):\")
    for e in errors:
        pk = e.get('propertyKey','?')
        stage = e.get('stage','?')
        retry = e.get('retryable','?')
        msg = e.get('error','')[:200]
        print(f\"  {pk} | stage: {stage} | retryable: {retry} | {msg}\")
else:
    print(f\"\nNo errors!\")
" | tee -a "$LOG_FILE"

log "========================================================================"
log "Test complete. Full log: $LOG_FILE"
log "========================================================================"
