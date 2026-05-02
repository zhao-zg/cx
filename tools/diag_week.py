import sys, re
sys.path.insert(0, '../src')
from split_trainings import *

with open(INPUT_FILE, encoding='utf-8') as f:
    lines = f.readlines()

# seq=7 detail=938248-944426
d_start, d_end = 938248, 944426
detail_lines = lines[d_start:d_end+1]

print('=== 2025-07 detail中 第N周 和 周　X 行 ===')
cnt = 0
for i, raw in enumerate(detail_lines):
    s = raw.strip()
    if re.match(r'^第[一二三四五六七八九十]+周', s) or re.match(r'^周\s*[一二三四五六]$', s):
        # 显示前后几行
        before = lines[d_start+i-1].strip() if i > 0 else ''
        after_lines = [lines[d_start+i+j].strip() for j in range(1, 4) if d_start+i+j <= d_end]
        print(f'  [{d_start+i}] {repr(s)} | prev={repr(before)} | next0={repr(after_lines[0] if after_lines else "")}')
        cnt += 1
        if cnt > 30:
            print('... (more)')
            break
