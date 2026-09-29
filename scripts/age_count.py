import json,glob,re,unicodedata,collections
S,E='2026-09-01','2026-09-29 23:59:59'
recs={}
for f in glob.glob('input/api/*.txt'):
    d=json.load(open(f))
    for r in d['responses']:
        if S<=r['answered_at']<=E: recs[(d['form_id'],r['id'])]=(d['form_id'],r)
def val(r,key):
    return [a['value'] for a in r['answers'] if key in a['name']]
def age(r):
    for a in r['answers']:
        if 'ご年齢' in a['name']:
            t=unicodedata.normalize('NFKC',a['value'])
            m=re.search(r'\d+',t)
            if m: return int(m.group())
    return None
def job(r):
    v=val(r,'ご職業'); return v[0] if v else ''
rows=collections.defaultdict(list)
for fid,r in recs.values():
    rows[(r['line_friend_id'],r['answered_at'][:10])].append((fid,r))
cnt=collections.Counter();unk=[]
for (uid,day),lst in rows.items():
    ages=[age(r) for _,r in lst]
    good=[a for a in ages if a and 5<=a<=100]
    if good: a=good[0]
    else:
        jobs=[job(r) for _,r in lst]
        if any(j and j!='学生' for j in jobs): a=19
        else: unk.append((uid,lst[0][1]['line_name'],lst[0][1]['answered_at'],ages,jobs)); continue
    cnt['19+' if a>=19 else '18' if a==18 else '<=17']+=1
print(len(recs),'raw',len(rows),'dedup',dict(cnt),'unknown',len(unk))
for u in unk: print(u)
