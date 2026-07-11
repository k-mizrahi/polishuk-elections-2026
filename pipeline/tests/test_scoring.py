"""Scoring engine tests — the worked examples in docs/02 §6 are normative;
if these fail, either the code or the spec is wrong, and the spec wins."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scoring import (Partition, absolute_error, bet_score, compute_all,
                     weekly_average)

TRANSITIONS = [
    ("yesh_atid", "together"),
    ("bennett_2026", "together"),
    ("reservists", "yesodot"),
    ("raam", "joint_list"),
]


def test_doc02_example_a_poll_bet_vs_fractional_average():
    avg = {"likud": 24.67, "together": 22.33, "democrats": 12.00, "shas": 9.67}
    bet = {"likud": 26, "together": 21, "democrats": 12, "shas": 10}
    # rest-of-map identical: restrict to these parties
    e = absolute_error(bet, avg, Partition([]))
    assert abs(e - (1.33 + 1.33 + 0 + 0.33)) < 1e-9
    # with the doc's assumed remaining error of 7.7 -> E = 10.7 -> 19.3
    assert bet_score(e + 7.71, "poll") == 19.3


def test_doc02_example_b_merger_scored_as_bloc():
    bet = {"yesh_atid": 15, "bennett_2026": 12, "likud": 30}
    official = {"together": 24, "likud": 30}
    e = absolute_error(bet, official, Partition(TRANSITIONS))
    assert e == 3  # |15+12-24| for the Together bloc, likud exact


def test_doc02_example_c_split_scored_as_bloc():
    bet = {"joint_list": 9}
    official = {"hadash_taal": 5, "balad": 4}
    trans = TRANSITIONS + [("hadash_taal", "joint_list"), ("balad", "joint_list")]
    assert absolute_error(bet, official, Partition(trans)) == 0


def test_weekly_average_unweighted_and_absent_is_zero():
    polls = [{"likud": 24, "shas": 8}, {"likud": 26}]  # shas absent in poll 2
    avg = weekly_average(polls)
    assert avg == {"likud": 25.0, "shas": 4.0}


def test_weekly_average_void_week():
    assert weekly_average([]) == {}


def test_score_floors_at_zero_and_rounds():
    assert bet_score(35, "poll") == 0.0
    assert bet_score(10.66, "poll") == 19.3
    assert bet_score(10, "final") == 80.0
    assert bet_score(60, "final") == 0.0


def test_compute_all_void_week_and_unscored_finals():
    bets = [
        {"user_id": "u1", "week_id": 1, "kind": "poll", "lines": {"likud": 30}},
        {"user_id": "u1", "week_id": 2, "kind": "poll", "lines": {"likud": 30}},
        {"user_id": "u1", "week_id": 1, "kind": "final", "lines": {"likud": 30}},
    ]
    avgs, scores = compute_all(
        polls_by_week={1: [{"likud": 28.0}], 2: []},   # week 2 void
        bets=bets, transitions=[], official_results=None)
    assert avgs[1] == {"likud": 28.0} and avgs[2] == {}
    kinds = [(s.week_id, s.kind) for s in scores]
    assert kinds == [(1, "poll")]      # void week + pre-election finals skipped
    assert scores[0].error == 2 and scores[0].score == 28.0


def test_compute_all_finals_scored_every_week_after_results():
    bets = [
        {"user_id": "u1", "week_id": w, "kind": "final", "lines": {"likud": 30, "shas": 90}}
        for w in (1, 2, 3)
    ]
    _, scores = compute_all(polls_by_week={}, bets=bets, transitions=[],
                            official_results={"likud": 32, "shas": 88})
    assert len(scores) == 3
    assert all(s.error == 4 and s.score == 92.0 for s in scores)


def test_recompute_is_deterministic():
    args = dict(polls_by_week={1: [{"likud": 28.0}, {"likud": 30.0}]},
                bets=[{"user_id": "u1", "week_id": 1, "kind": "poll",
                       "lines": {"likud": 30}}],
                transitions=[], official_results=None)
    assert compute_all(**args) == compute_all(**args)
