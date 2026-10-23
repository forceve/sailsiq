"""Experimental actual shell/fork intersection blend, not a production exporter."""
from pathlib import Path
import json, math, sys, time
import cadquery as cq
from OCP.TopExp import TopExp
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE
from OCP.TopTools import TopTools_IndexedDataMapOfShapeListOfShape
from validate_mast_sections import load_models

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'cadquery_out/v7_experiments'
OUT.mkdir(exist_ok=True)
m=load_models()[2]
p=m.P
node=cq.importers.importBrep(str(ROOT/'cadquery_out/v6_experiments/fork_agent_production_j80_combined.brep')).val()
shell=m.make_front_bracing_shell(p).val()
inside=m.SECTION.envelope_solid(p.mast_outer_w,p.mast_outer_h,p.bracket_z_h+10,p.silicone_gap).translate((0,0,p.mount_center_z-p.bracket_z_h/2-5)).val()
merged=node.fuse(shell).cut(inside).clean()
print('merged',merged.isValid(),len(merged.Solids()),flush=True)
merged.exportBrep(str(OUT/'j80_direct_fork_shell.brep'))
adj=TopTools_IndexedDataMapOfShapeListOfShape()
TopExp.MapShapesAndAncestors_s(merged.wrapped,TopAbs_EDGE,TopAbs_FACE,adj)
selected=[]
rows=[]
for i in range(1,adj.Extent()+1):
    e=cq.Edge(adj.FindKey(i)); fs=[cq.Face(f) for f in adj.FindFromIndex(i)]
    q=e.positionAt(.5)
    if len(fs)!=2 or not (q.x>20 and 0<q.y<40 and abs(q.z-p.mount_center_z)<22):continue
    x=m.SECTION.right_x_at_y(p.mast_outer_w,p.mast_outer_h,q.y,p.silicone_gap+p.front_bracing_side_t)
    angle=math.degrees(math.acos(max(-1,min(1,fs[0].normalAt(q).dot(fs[1].normalAt(q))))))
    rows.append(dict(index=i,point=q.toTuple(),length=e.Length(),angle=angle,shell_dx=q.x-x,faces=[f.geomType() for f in fs]))
    if abs(q.x-x)<.02 and angle>2: selected.append(e)
(OUT/'j80_direct_fork_shell_edges.json').write_text(json.dumps(rows,indent=2))
print('selected',len(selected),[round(e.Length(),3) for e in selected],flush=True)
for radius in [3.,4.,5.,6.,2.]:
    start=time.time()
    try:
        result=merged.fillet(radius,selected)
        valid=result.isValid() and len(result.Solids())==1
        print('R',radius,'valid',valid,'seconds',time.time()-start,flush=True)
        if valid: result.exportBrep(str(OUT/f'j80_direct_fillet_r{radius:g}.brep'))
    except Exception as error:print('R',radius,'failed',str(error),time.time()-start,flush=True)
