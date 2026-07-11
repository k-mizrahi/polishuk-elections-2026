"""Canonical party registry — mirrors supabase/seed.sql (docs/04 §5).

The pipeline needs the alias map and transition graph before the DB exists
(tests, dry runs); once live, the DB is authoritative and this module is only
the seed source. Keep the two in sync via `python cli.py seed-sql`.

Verified against the live Wikipedia page, 2026-07-11 (revid 1363501450).
Hebrew names ⚠️ pending owner review.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class Party:
    code: str
    name_he: str
    name_en: str
    color: str
    active_from: date
    active_until: date | None = None
    sort_order: int = 100


PARTIES = [
    # Currently running (July 2026)
    Party("likud", "הליכוד", "Likud", "#1d4ed8", date(2022, 11, 1), None, 10),
    Party("together", "ביחד", "Together", "#0ea5e9", date(2026, 4, 26), None, 20),
    Party("yashar", "ישר", "Yashar", "#7c3aed", date(2025, 1, 1), None, 30),
    Party("democrats", "הדמוקרטים", "The Democrats", "#16a34a", date(2024, 7, 12), None, 40),
    Party("blue_white", "כחול לבן", "Blue & White", "#38bdf8", date(2025, 6, 1), None, 50),
    Party("yesodot", "יסודות ישראל", "Yesodot Yisrael", "#f59e0b", date(2026, 7, 7), None, 60),
    Party("shas", 'ש"ס', "Shas", "#111827", date(2022, 11, 1), None, 70),
    Party("utj", "יהדות התורה", "United Torah Judaism", "#374151", date(2022, 11, 1), None, 80),
    Party("rzp", "הציונות הדתית", "Religious Zionist Party", "#365314", date(2022, 11, 1), None, 90),
    Party("otzma", "עוצמה יהודית", "Otzma Yehudit", "#78350f", date(2022, 11, 1), None, 100),
    Party("yisrael_beiteinu", "ישראל ביתנו", "Yisrael Beiteinu", "#0f766e", date(2022, 11, 1), None, 110),
    Party("raam", 'רע"מ', "Ra'am", "#065f46", date(2022, 11, 1), None, 120),
    Party("joint_list", "הרשימה המשותפת", "Joint List", "#b91c1c", date(2026, 6, 10), None, 130),
    # Historical (appear in older main tables; needed for backfill + transitions)
    Party("yesh_atid", "יש עתיד", "Yesh Atid", "#38bdf8", date(2022, 11, 1), date(2026, 4, 25), 200),
    Party("bennett_2026", "בנט 2026", "Bennett 2026", "#0ea5e9", date(2025, 1, 1), date(2026, 4, 25), 210),
    Party("reservists", "המילואימניקים", "Reservists", "#f59e0b", date(2025, 1, 1), date(2026, 7, 6), 220),
]

# (old_code, new_code, effective_on) — mergers/splits for carry-forward
# remapping and common-partition scoring (docs/02 §6).
TRANSITIONS = [
    ("yesh_atid", "together", date(2026, 4, 26)),
    ("bennett_2026", "together", date(2026, 4, 26)),
    ("reservists", "yesodot", date(2026, 7, 7)),
    # Joint List 2026 reunification; Ra'am ran jointly for a period mid-2026
    # and later split back out — the union keeps cross-era scoring fair.
    ("raam", "joint_list", date(2026, 6, 10)),
]

# Normalized Wikipedia column header -> party code (docs/05 header mapping).
ALIASES = {
    "likud": "likud",
    "together": "together",
    "rzp": "rzp",
    "otzma": "otzma",
    "blue & white": "blue_white",
    "shas": "shas",
    "utj": "utj",
    "yisrael beiteinu": "yisrael_beiteinu",
    "ra'am": "raam",
    "ra'am": "raam",  # curly-apostrophe variant
    "joint list": "joint_list",
    "dems": "democrats",
    "yashar": "yashar",
    "yesodot yisrael": "yesodot",
    "yesh atid": "yesh_atid",
    "bennett 2026": "bennett_2026",
    "reserv.": "reservists",
}

# Current coalition, for the Gov.-column checksum (docs/05 §4).
COALITION = {"likud", "rzp", "otzma", "shas", "utj"}
