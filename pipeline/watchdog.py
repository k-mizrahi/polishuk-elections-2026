"""Freshness watchdog — surfaces the gaps the pipeline can't self-report.

`scraper.py` files a GitHub issue when a run FAILS. But three things fail
*silently* — no run, no error, no issue:

  1. A cron that never ran — GitHub disables scheduled workflows after 60 days
     of repo inactivity, Supabase can pause, a local-only run can stop. Caught
     by a heartbeat: every successful scrape stamps `last_scrape_ok_at`; if that
     stamp goes stale, runs are being missed. (This is the "did we miss runs?"
     check — it is independent of *who* runs the scraper.)
  2. Wikipedia simply not carrying a poll yet that an outlet already published.
     Caught by watching an outlet's page for a republish and checking our DB
     caught up within a grace window.
  3. The review queue filling and nobody clearing it before the Wednesday
     finalize. Caught by ageing the pending rows.

Design mirrors scraper.py: the check functions are pure (state in -> alerts
out) and live below the thin I/O layer, so they unit-test against synthetic
state with no network or DB.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import requests

USER_AGENT = "polishuk-elections-watchdog/1.0 (contact: mizrahi.kobi@gmail.com)"

# Tunable at runtime via app_settings key 'watchdog_config' (partial override).
DEFAULTS = {
    "scrape_stale_hours": 12,     # scrape cron is 6h → 12h means ≥2 missed runs
    "poll_stale_days": 9,         # newest approved poll older than this = suspicious
    "pending_review_hours": 36,   # a pending row sitting unreviewed this long
    "outlet_grace_hours": 18,     # outlet republished but we ingested nothing since
}

# Outlets we watch to learn a poll SHOULD exist. We do NOT ingest their numbers
# (copyright + unstable shape, docs/06) — we only diff a freshness marker
# (Last-Modified/ETag) against our own ingest, so a Wikipedia lag becomes loud.
#
# n12  — the elections page is a Storycards static export; its story.json bumps
#        Last-Modified whenever N12 republishes (i.e. a poll dropped). Reachable.
#        (N12 also exposes a full structured feed at .../Home/GetSurveysData —
#        docs/06 — usable to *cross-validate* numbers; a future watchdog upgrade.)
# kan  — www.kan.org.il is behind a hard Cloudflare wall (Error 1000S) that a
#        headless CI runner cannot pass; kept here so the blind spot is EXPLICIT
#        (expected_blocked → we don't cry wolf every run, but we DO alert the day
#        it becomes reachable so it can be wired in). Kan's polls are Kantar-
#        commissioned and already reach us via Wikipedia regardless.
OUTLETS = {
    "n12": {
        "url": "https://storycards.co/mako/elections2026/story.json",
        "expected_blocked": False,
    },
    "kan": {
        "url": "https://www.kan.org.il/lobby/skarim/",
        "expected_blocked": True,
    },
}


@dataclass
class Alert:
    code: str        # stable id, e.g. "stale_scrape"
    message: str

    def __str__(self) -> str:
        return f"[{self.code}] {self.message}"


# ------------------------------------------------- pure checks

def _parse_iso(ts: str | None) -> datetime | None:
    if not ts:
        return None
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def check_scrape_heartbeat(now: datetime, last_ok_at: str | None,
                           cfg: dict) -> list[Alert]:
    """Missed/disabled cron, paused DB, stopped local runs — the heartbeat."""
    if not last_ok_at:
        return [Alert("stale_scrape",
                      "no successful scrape ever recorded (last_scrape_ok_at unset)")]
    age = now - _parse_iso(last_ok_at)
    limit = timedelta(hours=cfg["scrape_stale_hours"])
    if age > limit:
        hrs = age.total_seconds() / 3600
        return [Alert("stale_scrape",
                      f"last successful scrape was {hrs:.1f}h ago "
                      f"(> {cfg['scrape_stale_hours']}h) — cron may be disabled, "
                      f"Supabase paused, or runs are failing to complete")]
    return []


def check_poll_freshness(now: datetime, newest_fieldwork_end: str | None,
                         cfg: dict) -> list[Alert]:
    """Newest approved poll is old — we may be missing recent polls."""
    if not newest_fieldwork_end:
        return [Alert("stale_polls", "no approved polls in the DB at all")]
    age = now.date() - datetime.fromisoformat(newest_fieldwork_end).date()
    if age.days > cfg["poll_stale_days"]:
        return [Alert("stale_polls",
                      f"newest approved poll is {age.days}d old "
                      f"(> {cfg['poll_stale_days']}d) — check Wikipedia for polls "
                      f"we haven't ingested")]
    return []


def check_review_queue(now: datetime, pending: list[dict],
                       cfg: dict) -> list[Alert]:
    """Pending rows ageing past the review SLA (clear before Wednesday finalize).

    `pending`: rows of {scraped_at, pollster, fieldwork_end} for status=pending.
    """
    limit = timedelta(hours=cfg["pending_review_hours"])
    stale = [p for p in pending
             if (dt := _parse_iso(p.get("scraped_at"))) and now - dt > limit]
    if not stale:
        return []
    oldest = min(_parse_iso(p["scraped_at"]) for p in stale)
    age_h = (now - oldest).total_seconds() / 3600
    names = ", ".join(sorted({p["pollster"] for p in stale}))[:120]
    return [Alert("review_backlog",
                  f"{len(stale)} poll(s) pending review > "
                  f"{cfg['pending_review_hours']}h (oldest {age_h:.0f}h): {names} "
                  f"— approve/reject before the Wednesday finalize")]


def evaluate_outlets(now: datetime, probes: dict[str, dict],
                     prev_state: dict, newest_ingest_at: str | None,
                     cfg: dict) -> tuple[list[Alert], dict]:
    """Diff each outlet's freshness marker against our ingest.

    probes: {name: {reachable, marker, error}} from probe_outlet.
    prev_state: last run's {name: {marker, moved_at}} (from app_settings).
    Returns (alerts, new_state). new_state MUST be persisted every run — the
    moved/caught-up handshake is stateful.
    """
    alerts: list[Alert] = []
    new_state: dict = {}
    grace = timedelta(hours=cfg["outlet_grace_hours"])
    ingest_dt = _parse_iso(newest_ingest_at)

    for name, meta in OUTLETS.items():
        prev = prev_state.get(name, {})
        probe = probes.get(name, {"reachable": False, "marker": None,
                                  "error": "not probed"})
        st = {"marker": prev.get("marker"), "moved_at": prev.get("moved_at")}

        if not probe["reachable"]:
            # Unreachable: for a normally-open outlet that's a real alert; for a
            # known-blocked one it's expected, so we stay quiet — but flip an
            # alert the moment it becomes reachable (opportunity to wire it up).
            if not meta["expected_blocked"]:
                alerts.append(Alert("outlet_unreachable",
                                    f"{name} unreachable: {probe['error']}"))
            st["reachable"] = False
            new_state[name] = st
            continue

        if meta["expected_blocked"] and prev.get("reachable") is False:
            alerts.append(Alert("outlet_now_reachable",
                                f"{name} is reachable again ({meta['url']}) — "
                                f"it was blocked; consider wiring it in"))
        st["reachable"] = True
        marker = probe["marker"]
        st["marker"] = marker

        moved_at = _parse_iso(prev.get("moved_at"))
        if prev.get("marker") and marker and marker != prev["marker"] and not moved_at:
            moved_at = now  # first time we see this republish
        if moved_at:
            if ingest_dt and ingest_dt >= moved_at:
                moved_at = None  # we caught up — clear the pending republish
            elif now - moved_at >= grace:
                hrs = (now - moved_at).total_seconds() / 3600
                alerts.append(Alert("outlet_ahead",
                                    f"{name} republished {hrs:.0f}h ago but no "
                                    f"poll ingested since — Wikipedia may be "
                                    f"lagging; check for a missing poll"))
                moved_at = None  # alert once, then reset
        st["moved_at"] = moved_at.isoformat() if moved_at else None
        new_state[name] = st

    return alerts, new_state


# ------------------------------------------------- thin I/O

def probe_outlet(url: str, session: requests.Session | None = None) -> dict:
    """HTTP GET an outlet, return {reachable, marker, error}.

    The try/except is the feature, not a silent skip (cf. the no-bare-except
    rule): an unreachable outlet becomes an *alert*, never a swallowed error.
    """
    s = session or requests.Session()
    try:
        r = s.get(url, headers={"User-Agent": USER_AGENT}, timeout=30)
        r.raise_for_status()
        marker = r.headers.get("Last-Modified") or r.headers.get("ETag")
        return {"reachable": True, "marker": marker, "error": None}
    except requests.RequestException as e:
        return {"reachable": False, "marker": None, "error": str(e)[:200]}


def run_checks(db, now: datetime | None = None) -> tuple[list[Alert], dict]:
    """Gather state from the DB + outlets, run every check. Returns
    (alerts, new_outlet_state). Caller persists the state and sets exit code."""
    now = now or datetime.now(timezone.utc)
    cfg = {**DEFAULTS, **(db.get_setting("watchdog_config", {}) or {})}

    last_ok = db.get_setting("last_scrape_ok_at")
    approved = db.get("polls", select="fieldwork_end", status="eq.approved",
                      order="fieldwork_end.desc", limit="1")
    newest_fw = approved[0]["fieldwork_end"] if approved else None
    pending = db.get("polls", select="scraped_at,pollster,fieldwork_end",
                     status="eq.pending")
    latest_ingest = db.get("polls", select="scraped_at",
                           order="scraped_at.desc", limit="1")
    newest_ingest_at = latest_ingest[0]["scraped_at"] if latest_ingest else None

    prev_state = (db.get_setting("watchdog_state", {}) or {})
    probes = {name: probe_outlet(meta["url"]) for name, meta in OUTLETS.items()}

    alerts: list[Alert] = []
    alerts += check_scrape_heartbeat(now, last_ok, cfg)
    alerts += check_poll_freshness(now, newest_fw, cfg)
    alerts += check_review_queue(now, pending, cfg)
    outlet_alerts, new_state = evaluate_outlets(
        now, probes, prev_state, newest_ingest_at, cfg)
    alerts += outlet_alerts
    return alerts, new_state
