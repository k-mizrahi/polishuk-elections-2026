"""Scoring engine — normative spec in docs/02-scoring-spec.md.

Pure functions: (approved polls, bets, transition graph, official results,
constants) -> (weekly averages, scores). The engine always recomputes
everything from scratch; corrections self-heal (docs/02 §8).
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

DEFAULT_CONSTANTS = {
    # Caps are set well above the realistic max total error so the max(0, ·)
    # floor almost never binds (it only zeroes troll/random bets) — this keeps
    # information on large errors instead of collapsing them all to 0. Final is
    # 1.5× poll at equal error (docs/02 §4).
    "poll": {"base": 100.0, "per_seat": 1.0},
    "final": {"base": 150.0, "per_seat": 1.0},
}


# ------------------------------------------------- common partition (02 §6)

class Partition:
    """Union-find over party codes, seeded by party_transitions rows.

    Every party connected through any merger/split ends up in one group;
    errors are computed on group sums, so "merged parties are compared as
    a bloc" holds across eras.
    """

    def __init__(self, transitions: list[tuple[str, str]]):
        self._parent: dict[str, str] = {}
        for old, new in transitions:
            self._union(old, new)

    def _find(self, x: str) -> str:
        p = self._parent.setdefault(x, x)
        if p != x:
            self._parent[x] = p = self._find(p)
        return p

    def _union(self, a: str, b: str) -> None:
        ra, rb = self._find(a), self._find(b)
        if ra != rb:
            self._parent[ra] = rb

    def group(self, code: str) -> str:
        return self._find(code)

    def group_sums(self, seats: dict[str, float]) -> dict[str, float]:
        out: dict[str, float] = defaultdict(float)
        for code, v in seats.items():
            out[self.group(code)] += v
        return dict(out)


def absolute_error(bet: dict[str, float], target: dict[str, float],
                   partition: Partition) -> float:
    """E = sum over partition groups of |bet_sum - target_sum| (docs/02 §1)."""
    b, t = partition.group_sums(bet), partition.group_sums(target)
    return sum(abs(b.get(g, 0.0) - t.get(g, 0.0)) for g in set(b) | set(t))


# ------------------------------------------------- weekly average (02 §2)

def weekly_average(polls: list[dict[str, float]]) -> dict[str, float]:
    """Unweighted per-party mean over the week's approved polls; a party
    absent from a poll counts 0 in it. Returns {} for a void (zero-poll) week."""
    if not polls:
        return {}
    parties = {p for poll in polls for p in poll}
    n = len(polls)
    return {p: sum(poll.get(p, 0.0) for poll in polls) / n for p in parties}


# ------------------------------------------------- scores (02 §3–4)

def bet_score(error: float, kind: str, constants: dict | None = None) -> float:
    c = (constants or DEFAULT_CONSTANTS)[kind]
    return round(max(0.0, c["base"] - c["per_seat"] * error), 1)


@dataclass
class ScoreRow:
    user_id: str
    week_id: int
    kind: str
    error: float
    score: float


def compute_all(
    *,
    polls_by_week: dict[int, list[dict[str, float]]],   # approved only
    bets: list[dict],   # {user_id, week_id, kind, lines: {code: seats}}
    transitions: list[tuple[str, str]],
    official_results: dict[str, float] | None,
    constants: dict | None = None,
) -> tuple[dict[int, dict[str, float]], list[ScoreRow]]:
    """Full recompute. Returns (weekly_averages by week_id, score rows).

    - Poll bets: scored iff their week has >= 1 approved poll (void otherwise).
    - Final bets: scored for every week iff official_results is set.
    """
    partition = Partition(transitions)
    averages = {wk: weekly_average(ps) for wk, ps in polls_by_week.items()}

    scores: list[ScoreRow] = []
    for bet in bets:
        wk, kind = bet["week_id"], bet["kind"]
        if kind == "poll":
            target = averages.get(wk) or {}
            if not target:
                continue  # void week (docs/02 §2)
        elif kind == "final":
            if not official_results:
                continue
            target = official_results
        else:
            raise ValueError(f"unknown bet kind: {kind}")
        err = absolute_error(bet["lines"], target, partition)
        scores.append(ScoreRow(bet["user_id"], wk, kind,
                               round(err, 2), bet_score(err, kind, constants)))
    return averages, scores
