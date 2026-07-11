"""Weekly close logic — docs/06 weekly cycle.

Pure decision functions here; the cli orchestrates DB reads/writes around
them. Carry-forward happens when a week OPENS: every player's latest standing
bet of each kind is cloned into the new week (is_carried=true), remapped
through party transitions so active players always edit a current-list bet.
"""
from __future__ import annotations


def remap_lines(
    lines: dict[str, int],
    successors: dict[str, list[str]],   # old code -> active successor codes
    active: set[str],
) -> tuple[dict[str, int], bool]:
    """Remap a bet's lines onto the currently active party list.

    Mergers (single successor) fold seats into the successor. A split
    (multiple successors) or a dead-end party can't be remapped
    deterministically — the bet is carried unchanged and flagged
    (`needs_review`); scoring still handles it via the common partition
    (docs/02 §6). Returns (lines, needs_review).
    """
    out: dict[str, int] = {}
    for code, seats in lines.items():
        target = code
        hops = 0
        while target not in active:
            nxt = successors.get(target, [])
            if len(nxt) != 1 or hops > 10:
                return dict(lines), True  # split / dead end: carry as-is
            target = nxt[0]
            hops += 1
        out[target] = out.get(target, 0) + seats
    # every active party gets a line (0 allowed) — mirrors the DB trigger
    for code in active:
        out.setdefault(code, 0)
    # merger sums can produce 1-3 seat values only if inputs were 0/4+ and
    # distinct parties merged; sums of 4+ stay 4+, so validity is preserved.
    return out, False


def build_successors(transitions: list[tuple[str, str]]) -> dict[str, list[str]]:
    succ: dict[str, list[str]] = {}
    for old, new in transitions:
        succ.setdefault(old, [])
        if new not in succ[old]:
            succ[old].append(new)
    return succ


def carry_forward_plan(
    standing: dict[tuple[str, str], dict],   # (user_id, kind) -> latest bet
    existing_new_week: set[tuple[str, str]],  # (user_id, kind) already in new week
    successors: dict[str, list[str]],
    active: set[str],
) -> list[dict]:
    """Return the carried-bet rows to insert into the newly opened week."""
    plan = []
    for (user_id, kind), bet in standing.items():
        if (user_id, kind) in existing_new_week:
            continue
        lines, needs_review = remap_lines(bet["lines"], successors, active)
        plan.append({
            "user_id": user_id,
            "kind": kind,
            "lines": lines,
            "carried_from_bet_id": bet["id"],
            "needs_review": needs_review,
        })
    return plan
