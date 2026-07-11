"""Scraper tests against the saved live-page fixture (docs/05 fixture strategy).

The fixture is the real MediaWiki API response captured 2026-07-11
(revid 1363501450). When Wikipedia's format drifts, capture a new fixture
first, then fix the parser against it.
"""
import json
import sys
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import registry
import scraper

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "wikipedia_2026-07-11.json"


@pytest.fixture(scope="module")
def polls():
    html = json.loads(FIXTURE.read_text())["parse"]["text"]
    return scraper.parse_page(html, registry.ALIASES, min_year=2026)


def test_backfill_volume_and_cleanliness(polls):
    clean = [p for p in polls if not p.anomalies and not p.is_secondary]
    assert len(polls) >= 140
    assert len(clean) >= 130
    # anomalies are rare and every one carries a reason for the review queue
    flagged = [p for p in polls if p.anomalies]
    assert len(flagged) <= 8
    assert all(p.anomalies for p in flagged)


def test_known_row_kantar_9_jul(polls):
    p = next(p for p in polls
             if p.pollster == "Kantar" and p.fieldwork_end == date(2026, 7, 9))
    seats = {c: l.seats for c, l in p.results.items()}
    assert seats["likud"] == 24 and seats["yashar"] == 23 and seats["yesodot"] == 4
    assert p.results["blue_white"].below_threshold
    assert p.results["blue_white"].pct == 2.1
    assert p.publisher == "Israel Hayom"
    assert not p.anomalies
    assert scraper.check_gov_checksum(p, registry.COALITION, 53)


def test_bloc_subcolumns_sum_once(polls):
    # Filber 9 Jul reports Joint List as a single colspan=2 cell (5 seats);
    # the two leaf columns must not double it.
    p = next(p for p in polls
             if p.pollster == "Filber" and p.fieldwork_end == date(2026, 7, 9))
    assert p.results["joint_list"].seats == 5
    assert p.sample_size == 752
    assert not p.anomalies


def test_two_row_scenario_polls_marked_secondary(polls):
    secondaries = [p for p in polls if p.is_secondary]
    assert len(secondaries) >= 5
    # the known Kantar 11 Jun double row
    k = [p for p in polls
         if p.pollster == "Kantar" and p.fieldwork_end == date(2026, 6, 11)]
    assert len(k) == 2 and [p.is_secondary for p in k] == [False, True]


def test_announcement_rows_skipped(polls):
    assert not any("Yesodot Yisrael" in p.pollster or "form the" in p.pollster
                   for p in polls)


def test_all_clean_sums_are_120(polls):
    for p in polls:
        if p.anomalies:
            continue
        total = sum(l.seats for l in p.results.values())
        assert total <= 120  # remainder sits in Others
        assert total >= 100


def test_fingerprint_is_order_independent():
    a = scraper.ParsedPoll("X", None, None, date(2026, 1, 1), None,
                           {"a": scraper.ResultLine(4), "b": scraper.ResultLine(5)})
    b = scraper.ParsedPoll("X", None, None, date(2026, 1, 1), None,
                           {"b": scraper.ResultLine(5), "a": scraper.ResultLine(4)})
    assert a.fingerprint == b.fingerprint


def test_scenario_and_percentage_tables_never_ingested():
    html = json.loads(FIXTURE.read_text())["parse"]["text"]
    years = [y for y, _ in scraper.select_main_tables(html)]
    assert set(years) <= {2022, 2023, 2024, 2025, 2026}
    # the page has 34 wikitables; only the year-section seat tables qualify
    assert len(years) <= 6


def test_unmapped_party_column_aborts():
    html = json.loads(FIXTURE.read_text())["parse"]["text"]
    aliases = dict(registry.ALIASES)
    del aliases["yesodot yisrael"]  # simulate an unregistered merger
    with pytest.raises(scraper.ScraperError, match="Unmapped column"):
        scraper.parse_page(html, aliases, min_year=2026)


@pytest.mark.parametrize("text,year,expected", [
    ("9 Jul", 2026, (None, date(2026, 7, 9))),
    ("10–12 Jul", 2026, (date(2026, 7, 10), date(2026, 7, 12))),
    ("30 Jun – 3 Jul", 2026, (date(2026, 6, 30), date(2026, 7, 3))),
    ("28 Dec – 2 Jan", 2026, (date(2025, 12, 28), date(2026, 1, 2))),
    ("21– 22 Jan", 2026, (date(2026, 1, 21), date(2026, 1, 22))),
])
def test_date_parsing(text, year, expected):
    assert scraper.parse_date_range(text, year) == expected


@pytest.mark.parametrize("cell,seats,below,pct", [
    ("24", 24, False, None),
    ("(2.1%)", 0, True, 2.1),
    ("(<1%)", 0, True, 1.0),
    ("—", 0, False, None),
    ("— N/a", 0, False, None),
    ("", 0, False, None),
])
def test_seat_cell_parsing(cell, seats, below, pct):
    line = scraper.parse_seat_cell(cell)
    assert (line.seats, line.below_threshold, line.pct) == (seats, below, pct)
