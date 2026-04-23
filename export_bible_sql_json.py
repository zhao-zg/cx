#!/usr/bin/env python3
"""
从 SQLite 数据（.db 文件，或可选 SQL dump）导出三份 JSON：
- bible-text.json   经文（带 {注解序号} / [串珠字母] 标记）
- bible-notes.json  注解
- bible-xrefs.json  串珠

默认优先读取 bible-db/CG.db（即主库 main.db）。
如需从 SQL dump 导出，请显式传入 --sql-dump。
输出默认到 output/data-sql/，避免覆盖现有 src/static/data/。
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple


HERE = Path(__file__).resolve().parent
DEFAULT_SQL_DUMP: Optional[Path] = None
DEFAULT_SQLITE_DB_CANDIDATES = [
    HERE / "bible-db" / "CG.db",
    HERE / "resource" / "bible-db" / "CG.db",
]
DEFAULT_OUT_DIR = HERE / "output" / "data-sql"


def resolve_default_sqlite_db() -> Optional[Path]:
    for p in DEFAULT_SQLITE_DB_CANDIDATES:
        if p.exists():
            return p
    return None


@dataclass(frozen=True)
class VerseKey:
    book_index: int
    chapter: int
    section: int


def _clean_sql_dump_text(sql_text: str) -> str:
    # sqlite_sequence 是 SQLite 内部表，不能在内存库里显式 CREATE。
    sql_text = re.sub(
        r'DROP TABLE IF EXISTS "sqlite_sequence";\s*CREATE TABLE "sqlite_sequence"\s*\([^;]*?\);',
        "",
        sql_text,
        flags=re.S,
    )
    sql_text = re.sub(r'INSERT INTO "sqlite_sequence" VALUES \([^;]*?\);', "", sql_text)
    return sql_text


def open_db(sql_dump: Optional[Path], sqlite_db: Optional[Path]) -> sqlite3.Connection:
    if sqlite_db:
        return sqlite3.connect(str(sqlite_db))

    if not sql_dump or not sql_dump.exists():
        raise FileNotFoundError(f"SQL dump not found: {sql_dump}")

    conn = sqlite3.connect(":memory:")
    sql_text = sql_dump.read_text(encoding="utf-8")
    sql_text = _clean_sql_dump_text(sql_text)
    conn.executescript(sql_text)
    return conn


def load_book_acronym_map(conn: sqlite3.Connection) -> Dict[int, str]:
    """取 1..66 书卷简称，优先中文简称。"""
    rows = conn.execute(
        """
        SELECT book_index, acronym_name, name, _id
        FROM book_name
        WHERE book_index BETWEEN 1 AND 66
        ORDER BY book_index, _id
        """
    ).fetchall()

    grouped: Dict[int, List[Tuple[str, str]]] = defaultdict(list)
    for book_index, acronym_name, name, _id in rows:
        grouped[int(book_index)].append((str(acronym_name or ""), str(name or "")))

    result: Dict[int, str] = {}
    han_re = re.compile(r"[\u4e00-\u9fff]")

    for book_index in range(1, 67):
        candidates = grouped.get(book_index, [])
        if not candidates:
            result[book_index] = str(book_index)
            continue

        chosen = None
        for acro, _name in candidates:
            if han_re.search(acro):
                chosen = acro
                break
        if not chosen:
            chosen = candidates[0][0]
        result[book_index] = chosen

    return result


def cn_num_to_int(s: str) -> Optional[int]:
    if s is None:
        return None
    s = s.strip()
    if not s:
        return None
    if s.isdigit():
        return int(s)

    cn = {
        "零": 0,
        "〇": 0,
        "○": 0,
        "一": 1,
        "二": 2,
        "三": 3,
        "四": 4,
        "五": 5,
        "六": 6,
        "七": 7,
        "八": 8,
        "九": 9,
    }

    if "百" in s or "十" in s:
        val = 0
        if "百" in s:
            i = s.index("百")
            h = s[:i]
            val += (cn.get(h, 1) if h else 1) * 100
            s = s[i + 1 :]
        if "十" in s:
            i = s.index("十")
            t = s[:i]
            val += (cn.get(t, 0) if t else 1) * 10
            s = s[i + 1 :]
        for ch in s:
            val += cn.get(ch, 0)
        return val

    digits: List[int] = []
    for ch in s:
        d = cn.get(ch)
        if d is None:
            return None
        digits.append(d)
    if len(digits) == 1:
        return digits[0]
    if len(digits) == 2:
        return digits[0] * 10 + digits[1]
    if len(digits) == 3:
        return digits[0] * 100 + digits[1] * 10 + digits[2]
    return None


def build_book_token_map(book_map: Dict[int, str]) -> Dict[str, str]:
    """构造串珠文本里的书卷识别映射（尽量覆盖常见别名）。"""
    token_map: Dict[str, str] = {}
    for _idx, abbr in book_map.items():
        token_map[abbr] = abbr

    # 常见别名补充
    aliases = {
        "约壹": "约壹",
        "约一": "约壹",
        "约贰": "约贰",
        "约二": "约贰",
        "约叁": "约叁",
        "约三": "约叁",
        "王上": "王上",
        "王下": "王下",
        "撒上": "撒上",
        "撒下": "撒下",
        "代上": "代上",
        "代下": "代下",
        "林前": "林前",
        "林后": "林后",
        "帖前": "帖前",
        "帖后": "帖后",
        "提前": "提前",
        "提后": "提后",
        "彼前": "彼前",
        "彼后": "彼后",
    }
    token_map.update(aliases)
    return token_map


def normalize_xrefs(raw: str, token_map: Dict[str, str]) -> str:
    """将串珠原文尽量归一为 '书1:1,书1:2' 形式。

    注意：该归一是启发式，复杂写法（如多重区间、夹注）可能仍保留原貌。
    """
    if not raw:
        return ""

    text = raw.strip()
    text = re.sub(r"^[参见]\s*", "", text)
    text = (
        text.replace("，", ",")
        .replace("；", ",")
        .replace("、", ",")
        .replace("。", "")
        .replace("：", ":")
        .replace("～", "-")
    )

    parts = [p.strip() for p in text.split(",") if p.strip()]
    out: List[str] = []
    cur_book: Optional[str] = None
    cur_chapter: Optional[int] = None

    # 从长到短匹配书卷 token
    tokens = sorted(token_map.keys(), key=len, reverse=True)

    for part in parts:
        p = re.sub(r"^[参见]\s*", "", part)
        if not p:
            continue

        # 提取书卷 token
        book = None
        for tk in tokens:
            if p.startswith(tk):
                book = token_map[tk]
                p = p[len(tk) :]
                break

        if book:
            cur_book = book

        # 尝试 chapter:verse
        m = re.match(r"^([一二三四五六七八九十百零〇○\d]+):([一二三四五六七八九十百零〇○\d]+(?:-[一二三四五六七八九十百零〇○\d]+)?)$", p)
        if m:
            ch = cn_num_to_int(m.group(1))
            if ch is None:
                out.append(part)
                continue
            cur_chapter = ch
            vr = m.group(2)
            # verse 或 verse-range
            if "-" in vr:
                a, b = vr.split("-", 1)
                va = cn_num_to_int(a)
                vb = cn_num_to_int(b)
                if va is None or vb is None or not cur_book:
                    out.append(part)
                else:
                    out.append(f"{cur_book}{ch}:{va}-{vb}")
            else:
                vv = cn_num_to_int(vr)
                if vv is None or not cur_book:
                    out.append(part)
                else:
                    out.append(f"{cur_book}{ch}:{vv}")
            continue

        # 尝试 chapter+verse（如 约一1）
        m = re.match(r"^([一二三四五六七八九十百零〇○\d]+)([一二三四五六七八九十百零〇○\d]+(?:-[一二三四五六七八九十百零〇○\d]+)?)$", p)
        if m and cur_book:
            ch = cn_num_to_int(m.group(1))
            if ch is not None:
                cur_chapter = ch
                vr = m.group(2)
                if "-" in vr:
                    a, b = vr.split("-", 1)
                    va = cn_num_to_int(a)
                    vb = cn_num_to_int(b)
                    if va is not None and vb is not None:
                        out.append(f"{cur_book}{ch}:{va}-{vb}")
                        continue
                else:
                    vv = cn_num_to_int(vr)
                    if vv is not None:
                        out.append(f"{cur_book}{ch}:{vv}")
                        continue

        # 尝试仅 verse（继承 book + chapter）
        m = re.match(r"^([一二三四五六七八九十百零〇○\d]+(?:-[一二三四五六七八九十百零〇○\d]+)?)$", p)
        if m and cur_book and cur_chapter is not None:
            vr = m.group(1)
            if "-" in vr:
                a, b = vr.split("-", 1)
                va = cn_num_to_int(a)
                vb = cn_num_to_int(b)
                if va is not None and vb is not None:
                    out.append(f"{cur_book}{cur_chapter}:{va}-{vb}")
                    continue
            else:
                vv = cn_num_to_int(vr)
                if vv is not None:
                    out.append(f"{cur_book}{cur_chapter}:{vv}")
                    continue

        # 无法归一，保留原串
        out.append(part)

    return ",".join(out)


def apply_markers(
    verse_text: str,
    note_rows: Iterable[Tuple[int, int]],
    bead_rows: Iterable[Tuple[int, str]],
) -> str:
    """将 {seq} / [letter] 按 location 插入经文中。

    location 按 1-based 解释：插入在第 location 个字符前。
    """
    if not verse_text:
        return verse_text

    events: Dict[int, List[Tuple[int, str]]] = defaultdict(list)

    for location, seq in note_rows:
        if location is None or seq is None:
            continue
        events[int(location)].append((0, "{" + str(seq) + "}"))

    for location, letter in bead_rows:
        if location is None or letter is None:
            continue
        events[int(location)].append((1, "[" + str(letter) + "]"))

    chars = list(verse_text)
    out: List[str] = []

    # i 为当前“将要输出的字符”位置（1-based）
    for i, ch in enumerate(chars, start=1):
        if i in events:
            for _prio, token in sorted(events[i], key=lambda x: x[0]):
                out.append(token)
        out.append(ch)

    # 若有超出文本长度的标记，附加在末尾
    tail_positions = [p for p in events.keys() if p > len(chars)]
    for p in sorted(tail_positions):
        for _prio, token in sorted(events[p], key=lambda x: x[0]):
            out.append(token)

    return "".join(out)


def export_json(conn: sqlite3.Connection, out_dir: Path, normalize_xref: bool) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    book_map = load_book_acronym_map(conn)
    token_map = build_book_token_map(book_map)

    # 预取 footnote / bead
    footnote_by_flag: Dict[Tuple[int, int, int, int], List[Tuple[int, int]]] = defaultdict(list)
    notes_by_base: Dict[VerseKey, Dict[str, str]] = defaultdict(dict)

    foot_rows = conn.execute(
        """
        SELECT book_index, chapter, section, flag, location, seq, note
        FROM footnote
        ORDER BY book_index, chapter, section, flag, seq, location
        """
    ).fetchall()
    for b, ch, sec, flag, loc, seq, note in foot_rows:
        key_flag = (int(b), int(ch), int(sec), int(flag))
        if loc is not None and seq is not None:
            footnote_by_flag[key_flag].append((int(loc), int(seq)))

        if note is not None:
            note_text = str(note).strip()
            if note_text:
                base = VerseKey(int(b), int(ch), int(sec))
                notes_by_base[base][str(seq)] = note_text

    bead_by_flag: Dict[Tuple[int, int, int, int], List[Tuple[int, str]]] = defaultdict(list)
    xrefs_by_base: Dict[VerseKey, Dict[str, str]] = defaultdict(dict)

    bead_rows = conn.execute(
        """
        SELECT book_index, chapter, section, flag, location, seq, bead
        FROM bead
        ORDER BY book_index, chapter, section, flag, seq, location
        """
    ).fetchall()
    for b, ch, sec, flag, loc, seq, bead_text in bead_rows:
        key_flag = (int(b), int(ch), int(sec), int(flag))
        if loc is not None and seq is not None:
            bead_by_flag[key_flag].append((int(loc), str(seq)))

        if bead_text is not None:
            text = str(bead_text).strip()
            if text:
                base = VerseKey(int(b), int(ch), int(sec))
                if normalize_xref:
                    text = normalize_xrefs(text, token_map)
                xrefs_by_base[base][str(seq)] = text

    # 导出 text
    bible_text: Dict[str, str] = {}
    content_rows = conn.execute(
        """
        SELECT book_index, chapter, section, flag, content
        FROM content
        ORDER BY book_index, chapter, section, flag
        """
    ).fetchall()

    for b, ch, sec, flag, content in content_rows:
        b = int(b)
        ch = int(ch)
        sec = int(sec)
        flag = int(flag)
        verse = str(content or "")

        suffix = ""
        if flag == 1:
            suffix = "上"
        elif flag == 2:
            suffix = "下"

        book_abbr = book_map.get(b, str(b))
        key = f"{book_abbr}{ch}:{sec}{suffix}"

        # 文本标记只按同 flag 注入，另兼容 flag=0 的公共标记。
        note_rows = list(footnote_by_flag.get((b, ch, sec, flag), []))
        if flag != 0:
            note_rows.extend(footnote_by_flag.get((b, ch, sec, 0), []))

        bead_rows2 = list(bead_by_flag.get((b, ch, sec, flag), []))
        if flag != 0:
            bead_rows2.extend(bead_by_flag.get((b, ch, sec, 0), []))

        bible_text[key] = apply_markers(verse, note_rows, bead_rows2)

    # 导出 notes/xrefs：统一使用 base key（不带 上/下）
    bible_notes: Dict[str, Dict[str, str]] = {}
    for base, seq_map in notes_by_base.items():
        if not seq_map:
            continue
        book_abbr = book_map.get(base.book_index, str(base.book_index))
        key = f"{book_abbr}{base.chapter}:{base.section}"
        sorted_items = sorted(seq_map.items(), key=lambda kv: int(kv[0]))
        bible_notes[key] = {k: v for k, v in sorted_items}

    bible_xrefs: Dict[str, Dict[str, str]] = {}
    for base, seq_map in xrefs_by_base.items():
        if not seq_map:
            continue
        book_abbr = book_map.get(base.book_index, str(base.book_index))
        key = f"{book_abbr}{base.chapter}:{base.section}"
        sorted_items = sorted(seq_map.items(), key=lambda kv: kv[0])
        bible_xrefs[key] = {k: v for k, v in sorted_items}

    p_text = out_dir / "bible-text.json"
    p_notes = out_dir / "bible-notes.json"
    p_xrefs = out_dir / "bible-xrefs.json"

    p_text.write_text(json.dumps(bible_text, ensure_ascii=False, indent=2), encoding="utf-8")
    p_notes.write_text(json.dumps(bible_notes, ensure_ascii=False, indent=2), encoding="utf-8")
    p_xrefs.write_text(json.dumps(bible_xrefs, ensure_ascii=False, indent=2), encoding="utf-8")

    def _mb(p: Path) -> float:
        return p.stat().st_size / 1024.0 / 1024.0

    print(f"导出完成：{out_dir}")
    print(f"  bible-text.json   : {len(bible_text)} 节, {_mb(p_text):.2f} MB")
    print(f"  bible-notes.json  : {len(bible_notes)} 节, {_mb(p_notes):.2f} MB")
    print(f"  bible-xrefs.json  : {len(bible_xrefs)} 节, {_mb(p_xrefs):.2f} MB")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="从 SQL 数据导出圣经 JSON")
    p.add_argument("--sql-dump", type=Path, default=DEFAULT_SQL_DUMP, help="可选：SQL dump 路径")
    p.add_argument("--sqlite-db", type=Path, default=None, help="直接读取 sqlite db 文件；提供时优先于 --sql-dump")
    p.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR, help="输出目录（默认 output/data-sql）")
    p.add_argument("--normalize-xrefs", action="store_true", help="启用串珠文本归一（启发式）")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    sqlite_db = args.sqlite_db
    if sqlite_db is None:
        sqlite_db = resolve_default_sqlite_db()

    if sqlite_db is not None:
        print(f"数据源：SQLite DB -> {sqlite_db}")
    else:
        print(f"数据源：SQL dump -> {args.sql_dump}")

    conn = open_db(args.sql_dump, sqlite_db)
    try:
        export_json(conn, args.out_dir, normalize_xref=args.normalize_xrefs)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
