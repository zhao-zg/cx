#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
更新 changelog.json（根目录）中的版本更新内容
由 release.bat 调用

用法：
  python update_changelog.py --version 1.3.3 --new "功能A" --new "功能B" --opt "优化1" --fix "修复1"
"""
import argparse
import json
import os
from datetime import date


CHANGELOG_FILE = 'changelog.json'


def load_changelog():
    if os.path.exists(CHANGELOG_FILE):
        with open(CHANGELOG_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}


def save_changelog(data):
    with open(CHANGELOG_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def main():
    parser = argparse.ArgumentParser(description='更新 changelog.json')
    parser.add_argument('--version', required=True, help='版本号，如 1.3.3')
    parser.add_argument('--new', dest='new_features', action='append', default=[], metavar='ITEM', help='新增功能（可多次使用）')
    parser.add_argument('--opt', dest='optimizations', action='append', default=[], metavar='ITEM', help='优化内容（可多次使用）')
    parser.add_argument('--fix', dest='bug_fixes', action='append', default=[], metavar='ITEM', help='修复Bug（可多次使用）')
    parser.add_argument('--date', default='', help='发布日期，默认为今天（格式 YYYY-MM-DD）')
    args = parser.parse_args()

    version = args.version.lstrip('v')
    new_items = [s.strip() for s in args.new_features if s.strip()]
    opt_items = [s.strip() for s in args.optimizations if s.strip()]
    fix_items = [s.strip() for s in args.bug_fixes if s.strip()]
    release_date = args.date.strip() if args.date.strip() else str(date.today())

    if not new_items and not opt_items and not fix_items:
        print(f'⚠ 版本 {version} 无任何更新内容，跳过写入')
        return

    changelog = load_changelog()

    entry = {'date': release_date}
    if new_items:
        entry['new'] = new_items
    if opt_items:
        entry['opt'] = opt_items
    if fix_items:
        entry['fix'] = fix_items

    changelog[version] = entry
    save_changelog(changelog)
    print(f'✓ changelog.json 已更新：版本 {version}（{release_date}）')
    if new_items:
        print(f'  新增: {" / ".join(new_items)}')
    if opt_items:
        print(f'  优化: {" / ".join(opt_items)}')
    if fix_items:
        print(f'  修复: {" / ".join(fix_items)}')


if __name__ == '__main__':
    main()
