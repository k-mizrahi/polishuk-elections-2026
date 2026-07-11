"""Wikipedia polls scraper — normative spec in docs/05-scraper-spec.md.

Fetches the opinion-polling page via the MediaWiki API, selects the main
seat-projection tables (H2 "Seat projections" -> year H3 sections only;
scenario/percentage tables are never ingested), and normalizes rows into
poll records keyed by canonical party codes.

Parsing is pure (no I/O) below `fetch_page`; everything is unit-testable
against fixtures/.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from datetime import date

import requests
from bs4 import BeautifulSoup, Tag

API_URL = "https://en.wikipedia.org/w/api.php"
PAGE_TITLE = "Opinion polling for the 2026 Israeli legislative election"
USER_AGENT = "polishuk-elections-scraper/1.0 (contact: mizrahi.kobi@gmail.com)"
SOURCE_URL = "https://en.wikipedia.org/wiki/" + PAGE_TITLE.replace(" ", "_")

MAIN_SECTION = "seat projections"
YEAR_HEADING = re.compile(r"^(20\d\d)")

# Meta columns (matched after normalization); anything else must be a party
# alias or the run aborts — the merger tripwire.
META_COLUMNS = {
    "fieldwork date": "date",
    "date": "date",
    "polling firm": "pollster",
    "publisher": "publisher",
    "sample size": "sample_size",
}
IGNORED_COLUMNS = {"others", "other", "gov.", "gov", "lead"}

MONTHS = {m: i + 1 for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun",
     "jul", "aug", "sep", "oct", "nov", "dec"])}

DASHES = "–—−-"  # en/em dash, minus, hyphen


class ScraperError(Exception):
    """Aborts the run loudly (unmapped column, layout drift)."""


@dataclass
class ResultLine:
    seats: float = 0.0
    below_threshold: bool = False
    pct: float | None = None
    note: str | None = None


@dataclass
class ParsedPoll:
    pollster: str
    publisher: str | None
    fieldwork_start: date | None
    fieldwork_end: date
    sample_size: int | None
    results: dict[str, ResultLine]          # party code -> line
    others_note: str | None = None
    anomalies: list[str] = field(default_factory=list)
    is_secondary: bool = False              # 2nd+ scenario row of one poll
    source_url: str = SOURCE_URL

    @property
    def fingerprint(self) -> str:
        vec = ",".join(
            f"{code}:{_fmt_seats(line.seats)}"
            for code, line in sorted(self.results.items()))
        raw = f"{self.pollster}|{self.fieldwork_end.isoformat()}|{vec}"
        return hashlib.sha256(raw.encode()).hexdigest()


def _fmt_seats(v: float) -> str:
    return str(int(v)) if float(v).is_integer() else f"{v:g}"


# ---------------------------------------------------------------- fetch

def fetch_page(session: requests.Session | None = None) -> dict:
    """Return the MediaWiki `parse` payload: {title, revid, text}."""
    s = session or requests.Session()
    r = s.get(API_URL, params={
        "action": "parse", "page": PAGE_TITLE,
        "prop": "text|revid", "format": "json", "formatversion": "2",
        "redirects": "1",  # the page gets renamed as election naming firms up
    }, headers={"User-Agent": USER_AGENT}, timeout=60)
    r.raise_for_status()
    payload = r.json()
    if "error" in payload:
        raise ScraperError(f"MediaWiki API error: {payload['error']}")
    return payload["parse"]


# ------------------------------------------------- table selection

def select_main_tables(html: str) -> list[tuple[int, Tag]]:
    """Return [(year, table)] for tables under 'Seat projections' year sections."""
    soup = BeautifulSoup(html, "lxml")
    out: list[tuple[int, Tag]] = []
    section = subsection = None
    for el in soup.find_all(["h2", "h3", "table"]):
        if el.name == "h2":
            section, subsection = el.get_text(" ", strip=True).casefold(), None
        elif el.name == "h3":
            subsection = el.get_text(" ", strip=True)
        elif "wikitable" in (el.get("class") or []):
            if section == MAIN_SECTION and subsection:
                m = YEAR_HEADING.match(subsection)
                if m:
                    out.append((int(m.group(1)), el))
    if not out:
        raise ScraperError("No main poll tables found — page layout drifted")
    return out


# ------------------------------------------------- grid expansion

@dataclass
class Cell:
    text: str
    is_header: bool


def expand_grid(table: Tag) -> list[list[Cell]]:
    """Expand rowspan/colspan into a dense grid. Spanned positions share the
    same Cell object, so consumers can dedupe by identity (a bloc value with
    colspan=2 must be counted once, not twice)."""
    grid: list[list[Cell | None]] = []
    for row_idx, tr in enumerate(table.find_all("tr")):
        while len(grid) <= row_idx:  # rowspans may have pre-created this row
            grid.append([])
        col = 0
        for td in tr.find_all(["th", "td"]):
            while col < len(grid[row_idx]) and grid[row_idx][col] is not None:
                col += 1
            for sup in td.find_all("sup"):  # strip footnote refs
                sup.decompose()
            cell = Cell(td.get_text(" ", strip=True), td.name == "th")
            rs = int(td.get("rowspan") or 1)
            cs = int(td.get("colspan") or 1)
            for r in range(row_idx, row_idx + rs):
                while len(grid) <= r:
                    grid.append([])
                row = grid[r]
                while len(row) < col + cs:
                    row.append(None)
                for c in range(col, col + cs):
                    row[c] = cell
            col += cs
    width = max((len(r) for r in grid), default=0)
    return [
        [c or Cell("", False) for c in row + [None] * (width - len(row))]
        for row in grid
    ]


# ------------------------------------------------- cell parsers

_PCT = re.compile(r"\(?\s*(?:<\s*)?(\d+(?:\.\d+)?)\s*%\s*\)?")
_INT = re.compile(r"^\d+$")


def parse_seat_cell(text: str) -> ResultLine:
    t = text.strip()
    if not t or all(ch in DASHES + " " for ch in t) or t.casefold() in ("n/a", "— n/a"):
        return ResultLine(0)
    if _INT.match(t):
        return ResultLine(float(t))
    m = _PCT.match(t)
    if m:
        rest = t[m.end():].strip() or None
        return ResultLine(0, below_threshold=True, pct=float(m.group(1)), note=rest)
    raise ValueError(f"unparseable seat cell: {text!r}")


def parse_sample_size(text: str) -> int | None:
    t = text.replace(",", "").strip()
    m = re.search(r"\d+", t)
    return int(m.group()) if m else None


def parse_date_range(text: str, year: int) -> tuple[date | None, date]:
    """'9 Jul' / '10–12 Jul' / '30 Jun – 3 Jul' (+ optional explicit year)."""
    t = re.sub(f"[{DASHES}]", "-", text).strip()
    ym = re.search(r"(20\d\d)", t)
    if ym:
        year = int(ym.group(1))
        t = t.replace(ym.group(1), "").strip()

    def _one(part: str, default_month: int | None = None) -> tuple[int, int]:
        part = part.strip()
        m = re.match(r"(\d{1,2})\s*([A-Za-z]*)", part)
        if not m:
            raise ValueError(f"unparseable date part: {part!r}")
        day = int(m.group(1))
        mon_txt = m.group(2)[:3].casefold()
        month = MONTHS.get(mon_txt, default_month)
        if month is None:
            raise ValueError(f"missing month in date part: {part!r}")
        return day, month

    parts = [p for p in t.split("-") if p.strip()]
    if len(parts) == 1:
        d, m = _one(parts[0])
        return None, date(year, m, d)
    if len(parts) == 2:
        d2, m2 = _one(parts[1])
        d1, m1 = _one(parts[0], default_month=m2)  # '10-12 Jul' inherits Jul
        end = date(year, m2, d2)
        start_year = year - 1 if m1 > m2 else year  # Dec -> Jan crossing
        return date(start_year, m1, d1), end
    raise ValueError(f"unparseable date range: {text!r}")


# ------------------------------------------------- table -> polls

def normalize_header(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().casefold()


def parse_table(table: Tag, year: int, alias_map: dict[str, str]) -> list[ParsedPoll]:
    """alias_map: normalized top-level header -> party code.

    Multi-row headers: the TOP header names the canonical (bloc) party; leaf
    sub-columns (e.g. Hadash-Ta'al / Balad under Joint List) are summed into
    it — the bloc is what appears on the ballot and what bets are placed on.
    """
    grid = expand_grid(table)
    n_header = 0
    for row in grid:
        if all(c.is_header or not c.text for c in row):
            n_header += 1
        else:
            break
    if n_header == 0:
        raise ScraperError("table without header rows")

    top = grid[0]
    columns: dict[int, tuple[str, str]] = {}  # col -> (kind, key)
    for j, cell in enumerate(top):
        name = normalize_header(cell.text)
        if not name:
            continue
        if name in META_COLUMNS:
            columns[j] = ("meta", META_COLUMNS[name])
        elif name in IGNORED_COLUMNS:
            columns[j] = ("ignored", name)
        elif name in alias_map:
            columns[j] = ("party", alias_map[name])
        else:
            raise ScraperError(
                f"Unmapped column: {cell.text!r} — if this is a new party/merger, "
                "run the merger-day runbook (docs/06) and add a party_aliases row")

    polls: list[ParsedPoll] = []
    prev_date_cell: Cell | None = None
    for row in grid[n_header:]:
        if all(not c.text for c in row):
            continue
        meta: dict[str, str] = {}
        date_cell: Cell | None = None
        party_cells: dict[str, list[Cell]] = {}
        others_cells: list[Cell] = []
        for j, cell in enumerate(row):
            kind, key = columns.get(j, ("ignored", "?"))
            if kind == "meta":
                if key == "date" and date_cell is None:
                    date_cell = cell
                if key not in meta or not meta[key]:
                    meta[key] = cell.text
            elif kind == "party":
                party_cells.setdefault(key, []).append(cell)
            elif key in ("others", "other"):
                others_cells.append(cell)

        # Announcement rows: one text cell spanning the party columns
        # ("X and Y merge to form Z...") — political events, not polls.
        unique_party = {id(c): c for cells in party_cells.values() for c in cells}
        if len(unique_party) <= 1 and not any(
                _INT.match(c.text) for c in unique_party.values()):
            continue

        anomalies: list[str] = []
        if not meta.get("date") or not meta.get("pollster"):
            continue  # separator rows
        is_secondary = prev_date_cell is not None and date_cell is prev_date_cell
        prev_date_cell = date_cell
        try:
            fw_start, fw_end = parse_date_range(meta["date"], year)
        except ValueError as e:
            anomalies.append(str(e))
            fw_start, fw_end = None, date(year, 1, 1)

        results: dict[str, ResultLine] = {}
        for code, cells in party_cells.items():
            seen: set[int] = set()
            total, below, pct, note = 0.0, False, None, None
            for c in cells:
                if id(c) in seen:
                    continue
                seen.add(id(c))
                try:
                    line = parse_seat_cell(c.text)
                except ValueError as e:
                    anomalies.append(f"{code}: {e}")
                    line = ResultLine(0)
                total += line.seats
                below = below or line.below_threshold
                pct = pct if pct is not None else line.pct
                note = note or line.note
            results[code] = ResultLine(total, below and total == 0, pct, note)

        others_note = None
        others_seats = 0.0
        for c in {id(c): c for c in others_cells}.values():
            try:
                line = parse_seat_cell(c.text)
                others_seats += line.seats
                if line.note or line.pct is not None:
                    others_note = c.text
            except ValueError:
                others_note = c.text

        total_seats = sum(r.seats for r in results.values()) + others_seats
        if total_seats != 120:
            anomalies.append(f"seat sum {total_seats:g} != 120")

        polls.append(ParsedPoll(
            pollster=meta["pollster"],
            publisher=meta.get("publisher") or None,
            fieldwork_start=fw_start,
            fieldwork_end=fw_end,
            sample_size=parse_sample_size(meta.get("sample_size", "")),
            results=results,
            others_note=others_note,
            anomalies=anomalies,
            is_secondary=is_secondary,
        ))
    return polls


def parse_page(html: str, alias_map: dict[str, str],
               min_year: int | None = None) -> list[ParsedPoll]:
    polls: list[ParsedPoll] = []
    for year, table in select_main_tables(html):
        if min_year and year < min_year:
            continue
        polls.extend(parse_table(table, year, alias_map))
    return polls


def check_gov_checksum(poll: ParsedPoll, coalition: set[str], gov_value: float) -> bool:
    return sum(poll.results[c].seats for c in coalition if c in poll.results) == gov_value
