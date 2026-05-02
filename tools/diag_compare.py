import json

old = json.load(open('../output/2025-07/training_old.json', encoding='utf-8'))
new = json.load(open('../output/2025-07/training.json', encoding='utf-8'))

co = old['chapters'][0]
cn = new['chapters'][0]
print('=== OLD detail_sections ch1 ===')
for s in co['detail_sections']:
    ch = len(s.get('children', []))
    lv = s['level']
    ti = s['title'][:55]
    print(f'  level={lv}  title={ti}  children={ch}')
print()
print('=== NEW detail_sections ch1 ===')
for s in cn['detail_sections']:
    ch = len(s.get('children', []))
    lv = s['level']
    ti = s['title'][:55]
    print(f'  level={lv}  title={ti}  children={ch}')
print()

mr0 = co['morning_revivals'][0]
print('=== OLD morning_revivals[0] ===')
print('day:', mr0['day'])
print('outline nodes:', len(mr0['outline']))
if mr0['outline']:
    o = mr0['outline'][0]
    print('  outline[0]:', o['level'], o['title'][:60])
fs = mr0.get('feeding_scriptures', [])
print('feeding_scriptures (count):', len(fs))
if fs:
    print('  first:', fs[0][:80])
mf = mr0.get('morning_feeding', [])
print('morning_feeding (count):', len(mf))
if mf:
    print('  first:', str(mf[0])[:100])
mr_rd = mr0.get('message_reading', [])
print('message_reading (count):', len(mr_rd))
if mr_rd:
    print('  first:', str(mr_rd[0])[:100])
print('feeding_refs:', str(mr0.get('feeding_refs', ''))[:80])
print('morning_feeding_contexts (count):', len(mr0.get('morning_feeding_contexts', [])))
print('message_reading_contexts (count):', len(mr0.get('message_reading_contexts', [])))

print()
print('=== OLD mr keys:', list(mr0.keys()))
print('=== NEW mr (expected none - count 0)')
