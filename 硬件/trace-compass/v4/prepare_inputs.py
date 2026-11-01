"""Read-only extraction of supplied mechanical inputs; writes local inspection cache."""
from pathlib import Path
import hashlib,json,zipfile
import cadquery as cq
ROOT=Path(__file__).resolve().parent
SOURCE=ROOT.parents[1]/'compass元件设计文件'
if not SOURCE.exists(): SOURCE=ROOT/'references'
DEST=ROOT/'inspection';DEST.mkdir(exist_ok=True)
files=list((SOURCE/'PCB').glob('Altium*.zip'))
archive=zipfile.ZipFile(files[0]) if files else None
result={}
for name in ('MCU','BAT','MMU','SW'):
    path=SOURCE/'PCB/pcbmodels'/f'PCB_{name}.step'
    obj=cq.importers.importStep(str(path)).val()
    obj.exportBrep(str(DEST/f'{name}.brep'))
    if archive:
        member=next(n for n in archive.namelist() if f'/{name}/' in n and n.endswith('.pcbdoc'))
        (DEST/f'{name}.pcbdoc').write_bytes(archive.read(member))
    lines=(DEST/f'{name}.pcbdoc').read_text(errors='replace').splitlines()
    records=[dict(s.split('=',1) for s in line.split('|') if '=' in s) for line in lines]
    board=next(r for r in records if 'VX0' in r)
    mm=lambda s:float(s.replace('mil',''))*.0254
    x0=min(mm(v) for k,v in board.items() if k.startswith('VX'))
    y0=min(mm(v) for k,v in board.items() if k.startswith('VY'))
    components={r['SOURCEDESIGNATOR']:{'x':round(mm(r['X'])-x0,4),'y':round(mm(r['Y'])-y0,4),
      'rotation':float(r['ROTATION']),'pattern':r['PATTERN']} for r in records if r.get('RECORD')=='Component'}
    holes=[]
    for face in max(obj.Solids(),key=lambda s:s.Volume()).Faces():
        if face.geomType()=='CYLINDER':
            c=face._geomAdaptor().Cylinder();p=c.Location()
            h=[round(p.X(),4),round(p.Y(),4),round(c.Radius()*2,4)]
            if h not in holes:holes.append(h)
    result[name]=dict(components=components,cylinders=holes,step_sha256=hashlib.sha256(path.read_bytes()).hexdigest())
    print('Prepared '+name,flush=True)
(DEST/'pcb-datums.json').write_text(json.dumps(result,indent=2))
