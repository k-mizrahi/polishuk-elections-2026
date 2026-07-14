"""Pipeline entrypoints — run by GitHub Actions (docs/03), debuggable locally.

Usage:
  python cli.py scrape   [--dry-run]     # fetch Wikipedia -> ingest new polls
  python cli.py close    [--dry-run]     # week status flips + carry-forward + score
  python cli.py score    [--dry-run]     # full scoring recompute (docs/02 §8)
  python cli.py watchdog [--dry-run]     # freshness/heartbeat checks (docs/06)
  python cli.py seed-sql                 # print seed.sql from registry.py

--dry-run prints intended writes instead of performing them. `scrape --dry-run`
needs no credentials at all (hits Wikipedia only).
"""
from __future__ import annotations

import json
import sys
from datetime import date, datetime, timezone

import gameweeks
import registry
import scoring
import scraper
import weekly_close


# ------------------------------------------------------------ scrape

def cmd_scrape(dry_run: bool) -> int:
    page = scraper.fetch_page()
    revid = page["revid"]
    db = None
    if not dry_run:
        from db import Supa
        db = Supa()
        if db.get_setting("last_scraped_revid") == revid:
            print(f"revid {revid} unchanged — nothing to do")
            db.get("app_settings", select="key", limit="1")  # keep-alive
            db.set_setting("last_scrape_ok_at",
                           datetime.now(timezone.utc).isoformat())  # heartbeat
            return 0
        alias_rows = db.get("party_aliases", select="alias,parties(code)")
        alias_map = {scraper.normalize_header(r["alias"]): r["parties"]["code"]
                     for r in alias_rows}
        existing = {p["row_fingerprint"]: p for p in db.get(
            "polls", select="row_fingerprint,pollster,fieldwork_end,status")}
    else:
        alias_map = {scraper.normalize_header(k): v
                     for k, v in registry.ALIASES.items()}
        existing = {}

    polls = scraper.parse_page(page["text"], alias_map, min_year=2026)

    seen_versions = {(p["pollster"], p["fieldwork_end"]) for p in existing.values()}
    payload, n_pending = [], 0
    for p in polls:
        if p.fingerprint in existing:
            continue
        status, note = "approved", None
        if p.anomalies:
            status, note = "pending", "; ".join(p.anomalies)
        elif p.is_secondary:
            status, note = "pending", "secondary scenario row of a multi-row poll"
        elif (p.pollster, p.fieldwork_end.isoformat()) in seen_versions:
            status, note = "pending", "changed version of an already-ingested poll"
        n_pending += status == "pending"
        payload.append({
            "pollster": p.pollster, "publisher": p.publisher,
            "fieldwork_start": p.fieldwork_start.isoformat() if p.fieldwork_start else None,
            "fieldwork_end": p.fieldwork_end.isoformat(),
            "sample_size": p.sample_size, "source_url": p.source_url,
            "row_fingerprint": p.fingerprint, "status": status, "admin_note": note,
            "results": {c: {"seats": l.seats, "below_threshold": l.below_threshold,
                            "pct": l.pct} for c, l in p.results.items()},
        })

    print(f"parsed {len(polls)} polls, {len(payload)} new "
          f"({n_pending} routed to review queue)")
    if dry_run:
        for row in payload[:3]:
            print(json.dumps(row, ensure_ascii=False)[:200])
        return 0
    if payload:
        inserted = db.rpc("ingest_polls", {"p_polls": payload})
        print(f"ingested {inserted}")
    db.set_setting("last_scraped_revid", revid)
    db.set_setting("last_scrape_ok_at",
                   datetime.now(timezone.utc).isoformat())  # heartbeat (docs/06)
    if n_pending:
        print(f"::warning::{n_pending} polls awaiting admin review")
    return 0


# ------------------------------------------------------------ close

def cmd_close(dry_run: bool) -> int:
    from db import Supa
    db = Supa()
    now = datetime.now(timezone.utc).isoformat()

    # 1. status flips (idempotent; predicates on lock_at, docs/06)
    if not dry_run:
        db.patch("game_weeks", {"status": "locked"},
                 status="eq.open", lock_at=f"lt.{now}")
        # exactly one open week at a time: open the nearest scheduled week
        # (lock still ahead) only if none is currently open
        if not db.get("game_weeks", select="id", status="eq.open", limit="1"):
            sched = db.get("game_weeks", select="id",
                           status="eq.scheduled", lock_at=f"gt.{now}",
                           order="week_start", limit="1")
            if sched:
                db.patch("game_weeks", {"status": "open"}, id=f"eq.{sched[0]['id']}")

    open_weeks = db.get("game_weeks", select="id,week_start,week_end,lock_at",
                        status="eq.open", order="week_start", limit="1")
    if not open_weeks:
        print("no open week — nothing to carry forward")
    else:
        wk = open_weeks[0]
        parties = {p["id"]: p["code"] for p in db.get("parties", select="id,code")}
        active = {p["code"] for p in db.get(
            "parties", select="code",
            active_from=f"lte.{wk['week_end']}",
            or_=f"(active_until.is.null,active_until.gte.{wk['week_start']})")}
        trans = [(parties[t["old_party_id"]], parties[t["new_party_id"]])
                 for t in db.get("party_transitions", select="old_party_id,new_party_id")]
        banned = {p["id"] for p in db.get("profiles", select="id", is_banned="eq.true")}

        rows = db.get("bets", select="id,user_id,week_id,kind,bet_lines(party_id,seats)",
                      week_id=f"lt.{wk['id']}", order="week_id.desc")
        standing: dict[tuple[str, str], dict] = {}
        for b in rows:
            key = (b["user_id"], b["kind"])
            if key not in standing and b["user_id"] not in banned:
                standing[key] = {"id": b["id"], "lines": {
                    parties[l["party_id"]]: l["seats"] for l in b["bet_lines"]}}
        existing = {(b["user_id"], b["kind"]) for b in db.get(
            "bets", select="user_id,kind", week_id=f"eq.{wk['id']}")}
        plan = weekly_close.carry_forward_plan(
            standing, existing, weekly_close.build_successors(trans), active)
        print(f"carry-forward into week {wk['week_start']}: {len(plan)} bets")
        if not dry_run:
            for c in plan:
                db.rpc("admin_upsert_bet", {
                    "p_user_id": c["user_id"], "p_week_id": wk["id"],
                    "p_kind": c["kind"], "p_lines": c["lines"],
                    "p_carried_from": c["carried_from_bet_id"],
                    "p_needs_review": c["needs_review"]})

    # 2. full scoring recompute (also finalizes past weeks)
    return cmd_score(dry_run)


# ------------------------------------------------------------ score

def cmd_score(dry_run: bool) -> int:
    from db import Supa
    db = Supa()
    parties = {p["id"]: p["code"] for p in db.get("parties", select="id,code")}
    weeks = db.get("game_weeks", select="id,week_start,week_end,lock_at,status")
    now = datetime.now(timezone.utc)

    completed = [w for w in weeks
                 if date.fromisoformat(w["week_end"]) < now.date()
                 and w["status"] in ("locked", "scored", "open")]
    polls_by_week: dict[int, list[dict[str, float]]] = {w["id"]: [] for w in completed}
    for p in db.get("polls", select="game_week_id,poll_results(party_id,seats)",
                    status="eq.approved", game_week_id="not.is.null"):
        if p["game_week_id"] in polls_by_week:
            polls_by_week[p["game_week_id"]].append(
                {parties[r["party_id"]]: float(r["seats"]) for r in p["poll_results"]})

    lockable = {w["id"] for w in weeks
                if datetime.fromisoformat(w["lock_at"].replace("Z", "+00:00")) <= now}
    bets = []
    for b in db.get("bets", select="user_id,week_id,kind,bet_lines(party_id,seats)"):
        if b["week_id"] in lockable:  # never score an editable bet
            bets.append({"user_id": b["user_id"], "week_id": b["week_id"],
                         "kind": b["kind"],
                         "lines": {parties[l["party_id"]]: l["seats"]
                                   for l in b["bet_lines"]}})

    trans = [(parties[t["old_party_id"]], parties[t["new_party_id"]])
             for t in db.get("party_transitions", select="old_party_id,new_party_id")]
    official_rows = db.get("official_results", select="party_id,seats")
    official = {parties[r["party_id"]]: float(r["seats"])
                for r in official_rows} or None
    constants = db.get_setting("scoring_constants", scoring.DEFAULT_CONSTANTS)

    averages, score_rows = scoring.compute_all(
        polls_by_week=polls_by_week, bets=bets, transitions=trans,
        official_results=official, constants=constants)

    avg_payload = [{"week_id": wk, "party_code": code, "avg_seats": v,
                    "n_polls": len(polls_by_week[wk])}
                   for wk, avg in averages.items() for code, v in avg.items()]
    score_payload = [{"user_id": s.user_id, "week_id": s.week_id, "kind": s.kind,
                      "error": s.error, "score": s.score} for s in score_rows]
    print(f"averages for {len(averages)} weeks, {len(score_payload)} score rows")
    if dry_run:
        return 0
    db.rpc("apply_scoring", {"p_averages": avg_payload, "p_scores": score_payload})
    # weeks whose grace period passed are final (docs/06: Wednesday finalize)
    for w in completed:
        if (now.date() - date.fromisoformat(w["week_end"])).days >= 4:
            db.patch("game_weeks", {"status": "scored"},
                     id=f"eq.{w['id']}", status="eq.locked")
    print("scoring applied")
    return 0


# ------------------------------------------------------------ watchdog

def cmd_watchdog(dry_run: bool) -> int:
    """Freshness/heartbeat checks (docs/06). Exit 1 on any alert so the
    workflow's failure handler files a GitHub issue. State is persisted every
    run (even when alerting) so the outlet moved/caught-up handshake advances."""
    from db import Supa
    import watchdog
    db = Supa()
    alerts, new_state = watchdog.run_checks(db)
    if not dry_run:
        db.set_setting("watchdog_state", new_state)
    if not alerts:
        print("watchdog: all clear")
        return 0
    print(f"watchdog: {len(alerts)} alert(s)")
    for a in alerts:
        print(f"::warning::{a}")
    return 1


# ------------------------------------------------------------ seed

def _q(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def cmd_seed_sql() -> int:
    print("-- Generated by `python pipeline/cli.py seed-sql` — edit registry.py, not this file.")
    print("-- Parties/aliases verified against Wikipedia revid 1363501450 (2026-07-11).")
    for p in registry.PARTIES:
        until = f"'{p.active_until}'" if p.active_until else "null"
        print(f"insert into parties (code, name_he, name_en, color, active_from, active_until, sort_order) "
              f"values ('{p.code}', {_q(p.name_he)}, {_q(p.name_en)}, '{p.color}', "
              f"'{p.active_from}', {until}, {p.sort_order});")
    for alias, code in registry.ALIASES.items():
        print(f"insert into party_aliases (party_id, alias) "
              f"select id, {_q(alias)} from parties where code = '{code}';")
    for old, new, eff in registry.TRANSITIONS:
        print(f"insert into party_transitions (old_party_id, new_party_id, effective_on) "
              f"select o.id, n.id, '{eff}' from parties o, parties n "
              f"where o.code = '{old}' and n.code = '{new}';")
    for w in gameweeks.generate_weeks(date(2026, 7, 12), date(2027, 3, 31)):
        print(f"insert into game_weeks (week_start, week_end, lock_at) "
              f"values ('{w['week_start']}', '{w['week_end']}', '{w['lock_at']}');")
    constants = json.dumps(scoring.DEFAULT_CONSTANTS)
    print(f"insert into app_settings (key, value) values ('scoring_constants', '{constants}');")
    print("insert into app_settings (key, value) values ('election_date', 'null');")
    print("insert into app_settings (key, value) values ('last_scraped_revid', 'null');")
    return 0


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(2)
    cmd, dry = args[0], "--dry-run" in args
    sys.exit({"scrape": lambda: cmd_scrape(dry),
              "close": lambda: cmd_close(dry),
              "score": lambda: cmd_score(dry),
              "watchdog": lambda: cmd_watchdog(dry),
              "seed-sql": cmd_seed_sql}[cmd]())
