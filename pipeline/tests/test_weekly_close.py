import sys
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import gameweeks
from weekly_close import build_successors, carry_forward_plan, remap_lines

ACTIVE = {"likud", "together", "yesodot"}
SUCC = build_successors([
    ("yesh_atid", "together"), ("bennett_2026", "together"),
    ("reservists", "yesodot"),
    ("joint_list", "hadash_taal"), ("joint_list", "balad"),  # a split
])


def test_merger_remap_sums_constituents():
    lines = {"yesh_atid": 15, "bennett_2026": 12, "likud": 93}
    out, review = remap_lines(lines, SUCC, ACTIVE)
    assert not review
    assert out == {"together": 27, "likud": 93, "yesodot": 0}
    assert sum(out.values()) == 120


def test_split_carries_as_is_and_flags():
    lines = {"joint_list": 9, "likud": 111}
    out, review = remap_lines(lines, SUCC, ACTIVE)
    assert review and out == lines


def test_dead_end_party_flags():
    out, review = remap_lines({"ghost": 120}, SUCC, ACTIVE)
    assert review


def test_carry_forward_skips_players_who_already_bet():
    standing = {
        ("u1", "poll"): {"id": 1, "lines": {"likud": 120}},
        ("u2", "poll"): {"id": 2, "lines": {"likud": 120}},
    }
    plan = carry_forward_plan(standing, {("u1", "poll")}, SUCC, ACTIVE)
    assert [p["user_id"] for p in plan] == ["u2"]
    assert plan[0]["carried_from_bet_id"] == 2


def test_week_calendar():
    # 2026-07-11 is a Saturday -> its week started Sunday 2026-07-05
    assert gameweeks.week_start_for(date(2026, 7, 11)) == date(2026, 7, 5)
    assert gameweeks.week_start_for(date(2026, 7, 5)) == date(2026, 7, 5)
    # lock = preceding Friday 12:00 Israel = 09:00 UTC in July (IDT=UTC+3)
    lock = gameweeks.lock_at_for(date(2026, 7, 5))
    assert lock == datetime(2026, 7, 3, 9, 0, tzinfo=timezone.utc)
    # winter week: IST=UTC+2 -> 10:00 UTC (DST correctness)
    lock_w = gameweeks.lock_at_for(date(2026, 12, 6))
    assert lock_w == datetime(2026, 12, 4, 10, 0, tzinfo=timezone.utc)


def test_generate_weeks_contiguous():
    weeks = gameweeks.generate_weeks(date(2026, 7, 12), date(2026, 12, 31))
    assert weeks[0]["week_start"] == "2026-07-12"
    assert len(weeks) == 25
