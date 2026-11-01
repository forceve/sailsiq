"""Package a clearly unapproved review, and attach correction to old archive copies."""
from pathlib import Path
import json,zipfile,hashlib
p=Path(__file__).parent
sha=hashlib.sha256((p/'trace_compass_v4_1.py').read_bytes()).hexdigest()
for name in ('validation.json','export_validation.json'):
    r=json.loads((p/name).read_text())
    assert r['passed'] and r['source_sha256']==sha
assert json.loads((p/'validation.json').read_text())['release_ready'] is False
assert json.loads((p/'fpc_audit.json').read_text())['status']=='BLOCKED'
files=[p/n for n in ('README.md','PRINT_README.txt','validation.json','export_validation.json','fpc_audit.json','trace_compass_v4_1.py','audit_interfaces.py','validate_v4_1.py')]
files += list((p/'previews').glob('0[567]*.png'))
files += [p/'cadquery_out'/n for n in ('front_housing.step','front_housing.stl','mmu_pressure_frame.step','mmu_pressure_frame.stl','trace_compass_v4_1_REVIEW_NOT_RELEASED.step')]
out=p/'trace_compass_v4_1_REVIEW_NOT_RELEASED.zip'
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for f in files:z.write(f,str(f.relative_to(p)))
    z.writestr('SOURCE_DEPENDENCIES.txt','CAD source depends on the repository original compass component files and inspection caches. This review ZIP includes assembly STEP and changed structure files; it is not a standalone source rebuild package or print release.\n')
with zipfile.ZipFile(out) as z:assert z.testzip() is None
print(out.name,round(out.stat().st_size/1024/1024,2),'MiB')
old=p.parent/'v4'
notice=(old/'READ_FIRST_FPC_CORRECTION.txt').read_bytes()
for f in old.glob('trace_compass_v4_*.zip'):
    with zipfile.ZipFile(f,'a',zipfile.ZIP_DEFLATED) as z:
        if 'READ_FIRST_FPC_CORRECTION.txt' not in z.namelist():
            z.writestr('READ_FIRST_FPC_CORRECTION.txt',notice)
    print('Added correction notice:',f.name)
