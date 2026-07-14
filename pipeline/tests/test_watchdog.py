"""Watchdog check tests — pure state-in/alerts-out, no network or DB."""
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from watchdog import (DEFAULTS, check_poll_freshness, check_review_queue,
                      check_scrape_heartbeat, evaluate_outlets)

NOW = datetime(2026, 7, 14, 12, 0, tzinfo=timezone.utc)
CFG = DEFAULTS


def _codes(alerts):
    return {a.code for a in alerts}


# ---- heartbeat (the "did we miss runs?" check) ----

def test_heartbeat_fresh_ok():
    assert check_scrape_heartbeat(NOW, "2026-07-14T06:00:00+00:00", CFG) == []


def test_heartbeat_stale_alerts():
    # 20h old > 12h limit
    assert _codes(check_scrape_heartbeat(
        NOW, "2026-07-13T16:00:00+00:00", CFG)) == {"stale_scrape"}


def test_heartbeat_never_run_alerts():
    assert _codes(check_scrape_heartbeat(NOW, None, CFG)) == {"stale_scrape"}


def test_heartbeat_accepts_z_suffix():
    assert check_scrape_heartbeat(NOW, "2026-07-14T09:00:00Z", CFG) == []


# ---- poll freshness ----

def test_poll_freshness_recent_ok():
    assert check_poll_freshness(NOW, "2026-07-13", CFG) == []


def test_poll_freshness_stale_alerts():
    assert _codes(check_poll_freshness(NOW, "2026-07-01", CFG)) == {"stale_polls"}


def test_poll_freshness_none_alerts():
    assert _codes(check_poll_freshness(NOW, None, CFG)) == {"stale_polls"}


# ---- review backlog ----

def test_review_queue_empty_ok():
    assert check_review_queue(NOW, [], CFG) == []


def test_review_queue_fresh_pending_ok():
    pending = [{"scraped_at": "2026-07-14T06:00:00+00:00", "pollster": "Midgam",
                "fieldwork_end": "2026-07-13"}]
    assert check_review_queue(NOW, pending, CFG) == []  # only 6h old


def test_review_queue_stale_pending_alerts():
    pending = [{"scraped_at": "2026-07-12T00:00:00+00:00", "pollster": "Lazar",
                "fieldwork_end": "2026-07-11"}]  # 60h old > 36h
    alerts = check_review_queue(NOW, pending, CFG)
    assert _codes(alerts) == {"review_backlog"}
    assert "Lazar" in alerts[0].message


# ---- outlet watching (#2) ----

def test_outlet_first_sight_records_marker_no_alert():
    probes = {"n12": {"reachable": True, "marker": "etag-1", "error": None},
              "kan": {"reachable": False, "marker": None, "error": "403"}}
    alerts, state = evaluate_outlets(NOW, probes, {}, "2026-07-14T00:00:00+00:00", CFG)
    assert alerts == []                         # no prior marker => no "moved"
    assert state["n12"]["marker"] == "etag-1"


def test_kan_blocked_is_quiet_not_noisy():
    probes = {"n12": {"reachable": True, "marker": "e", "error": None},
              "kan": {"reachable": False, "marker": None, "error": "Cloudflare 403"}}
    alerts, _ = evaluate_outlets(NOW, probes, {}, None, CFG)
    assert alerts == []                         # expected_blocked => stays quiet


def test_open_outlet_unreachable_alerts():
    probes = {"n12": {"reachable": False, "marker": None, "error": "timeout"},
              "kan": {"reachable": False, "marker": None, "error": "403"}}
    alerts, _ = evaluate_outlets(NOW, probes, {}, None, CFG)
    assert _codes(alerts) == {"outlet_unreachable"}   # n12 only, not kan


def test_kan_becoming_reachable_alerts_opportunity():
    prev = {"kan": {"marker": None, "moved_at": None, "reachable": False}}
    probes = {"n12": {"reachable": True, "marker": "e", "error": None},
              "kan": {"reachable": True, "marker": "k1", "error": None}}
    alerts, _ = evaluate_outlets(NOW, probes, prev, None, CFG)
    assert _codes(alerts) == {"outlet_now_reachable"}


def test_outlet_moved_but_no_ingest_within_grace_alerts():
    # n12 marker changed 20h ago, our newest ingest predates the move
    prev = {"n12": {"marker": "old", "moved_at": "2026-07-13T16:00:00+00:00"}}
    probes = {"n12": {"reachable": True, "marker": "new", "error": None},
              "kan": {"reachable": False, "marker": None, "error": "403"}}
    alerts, state = evaluate_outlets(
        NOW, probes, prev, "2026-07-13T10:00:00+00:00", CFG)
    assert _codes(alerts) == {"outlet_ahead"}
    assert state["n12"]["moved_at"] is None      # alert-once: reset


def test_outlet_moved_but_we_caught_up_no_alert():
    # moved 20h ago but we ingested a poll AFTER the move => caught up
    prev = {"n12": {"marker": "old", "moved_at": "2026-07-13T16:00:00+00:00"}}
    probes = {"n12": {"reachable": True, "marker": "new", "error": None},
              "kan": {"reachable": False, "marker": None, "error": "403"}}
    alerts, state = evaluate_outlets(
        NOW, probes, prev, "2026-07-14T09:00:00+00:00", CFG)
    assert alerts == []
    assert state["n12"]["moved_at"] is None


def test_outlet_moved_within_grace_waits():
    # marker just changed this run; grace not elapsed => record, don't alert yet
    prev = {"n12": {"marker": "old", "moved_at": None}}
    probes = {"n12": {"reachable": True, "marker": "new", "error": None},
              "kan": {"reachable": False, "marker": None, "error": "403"}}
    alerts, state = evaluate_outlets(NOW, probes, prev, None, CFG)
    assert alerts == []
    assert state["n12"]["moved_at"] == NOW.isoformat()
