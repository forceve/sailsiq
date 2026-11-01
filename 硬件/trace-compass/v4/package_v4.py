"""Build review and rigid-fit-print packages only from passing, current geometry."""
from pathlib import Path
import hashlib,json,zipfile
ROOT=Path(__file__).resolve().parent
sha=hashlib.sha256((ROOT/'trace_compass_v4.py').read_bytes()).hexdigest()
for name in ('validation.json','export_validation.json'):
    r=json.loads((ROOT/name).read_text())
    assert r['passed'] and r['source_sha256']==sha,name+' is not current/passing'
rigid=['front_housing','rear_cover','mcu_carrier','lcd_support_tray','sw_carrier','keypad_clamp','mmu_polymer_gate']
print_path=ROOT/'trace_compass_v4_rigid_print_only.zip'
with zipfile.ZipFile(print_path,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for n in rigid:z.write(ROOT/'cadquery_out'/(n+'.stl'),n+'.stl')
    z.write(ROOT/'PRINT_README.txt','PRINT_README.txt')
    z.write(ROOT/'previews/00-layout-overview.jpg','CAD_overview.jpg')
full=ROOT/'trace_compass_v4_design_package.zip'
keep_inspection={'pcb-datums.json','step-inventory.json','MCU.pcbdoc','MMU.pcbdoc','BAT.pcbdoc','SW.pcbdoc'}
files=[]
for p in ROOT.rglob('*'):
    if not p.is_file() or '__pycache__' in p.parts or p.suffix=='.zip':continue
    if 'inspection' in p.parts and p.name not in keep_inspection:continue
    files.append(p)
with zipfile.ZipFile(full,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for p in files:z.write(p,str(Path('trace_compass_v4')/p.relative_to(ROOT)))
for p in (print_path,full):
    with zipfile.ZipFile(p) as z:
        assert z.testzip() is None
        print(p.name,len(z.namelist()),round(p.stat().st_size/1024/1024,2),'MiB',flush=True)
