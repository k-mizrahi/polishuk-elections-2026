"""Game-week calendar helpers — docs/00 glossary, docs/04 game_weeks.

A game week runs Sunday 00:00 – Saturday 23:59 Asia/Jerusalem (the "Sunday→Saturday"
poll window, docs/02 §2); bets for it lock at Saturday midnight immediately before
it — i.e. the week's own start instant, so the lock and the week boundary coincide
and no poll counting toward the week can be public before bets close. Stored
per-week in the DB; these helpers only generate the default schedule. Poll
membership keys on fieldwork_end within the window.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

IL_TZ = ZoneInfo("Asia/Jerusalem")
LOCK_TIME = time(0, 0)           # Saturday midnight == Sunday 00:00 Israel
SUNDAY = 6                       # date.weekday(): Mon=0 … Sun=6


def week_start_for(d: date) -> date:
    """The Sunday on or before d."""
    return d - timedelta(days=(d.weekday() - SUNDAY) % 7)


def week_end_for(d: date) -> date:
    return week_start_for(d) + timedelta(days=6)


def lock_at_for(week_start: date) -> datetime:
    """UTC-aware lock instant for the week starting at week_start (a Sunday):
    that Sunday at 00:00 Israel time — colloquially Saturday midnight."""
    local = datetime.combine(week_start, LOCK_TIME, tzinfo=IL_TZ)
    return local.astimezone(ZoneInfo("UTC"))


def generate_weeks(first: date, last: date) -> list[dict]:
    """Week rows (dicts matching game_weeks columns) covering [first, last]."""
    out = []
    ws = week_start_for(first)
    while ws <= last:
        out.append({
            "week_start": ws.isoformat(),
            "week_end": (ws + timedelta(days=6)).isoformat(),
            "lock_at": lock_at_for(ws).isoformat(),
        })
        ws += timedelta(days=7)
    return out
