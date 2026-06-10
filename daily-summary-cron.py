#!/usr/bin/env python3
"""Daily-summary cron — replaces the flaky GitHub Actions workflow.

Pings BOTH backends' POST /api/admin/daily-summary, guarded by the
DAILY_SUMMARY_KEY secret (sent as the X-Summary-Key header). Each app emails a
digest of the prior America/Chicago calendar day.

Run once a day by the Render Cron Job defined in render.yaml. Stdlib only — no
pip deps, no shell, no Docker-entrypoint surprises (which is what broke the
earlier curl-image attempt with exit 127).

Both endpoints are always attempted; the script exits non-zero if EITHER
ultimately fails, so a broken send shows up as a failed run in Render.
"""
import os
import sys
import time
import urllib.error
import urllib.request

ENDPOINTS = [
    ("TANTRO", "https://blockchainstorm.onrender.com/api/admin/daily-summary"),
    ("Circuitousness", "https://circuitousness-api.onrender.com/api/admin/daily-summary"),
]

RETRIES = 5          # total attempts per endpoint
RETRY_DELAY = 15     # seconds between attempts
TIMEOUT = 120        # per-request seconds (Render free tier can cold-start slowly)


def ping(label, url, key):
    """POST to one endpoint with retries. Return True on success."""
    req = urllib.request.Request(
        url,
        data=b"",  # forces a POST with an empty body
        method="POST",
        headers={"X-Summary-Key": key},
    )
    for attempt in range(1, RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                print(f"[{label}] {resp.status} {resp.reason}", flush=True)
                return True
        except urllib.error.HTTPError as e:
            print(f"[{label}] attempt {attempt}/{RETRIES} -> HTTP {e.code} {e.reason}", flush=True)
        except Exception as e:  # URLError, timeout, DNS, etc.
            print(f"[{label}] attempt {attempt}/{RETRIES} -> {type(e).__name__}: {e}", flush=True)
        if attempt < RETRIES:
            time.sleep(RETRY_DELAY)
    print(f"[{label}] FAILED after {RETRIES} attempts", flush=True)
    return False


def main():
    key = os.environ.get("DAILY_SUMMARY_KEY", "")
    if not key:
        print("DAILY_SUMMARY_KEY is not set — aborting.", flush=True)
        return 1
    # Attempt BOTH regardless of the first's outcome; fail if either fails.
    ok = True
    for label, url in ENDPOINTS:
        if not ping(label, url, key):
            ok = False
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
