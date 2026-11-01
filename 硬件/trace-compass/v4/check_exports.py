"""Validate delivered manufactured STEP geometry and closed STL surfaces."""
from pathlib import Path
import hashlib,json
import cadquery as cq
import vtk
import trace_compass_v4 as m

checks=[]
for name,obj in m.manufactured().items():
    original=obj.val();p=m.OUT/(name+'.step')
    loaded=cq.importers.importStep(str(p)).val()
    diff=max(0,original.cut(loaded).Volume())+max(0,loaded.cut(original).Volume())
    checks.append(dict(name=name+' STEP',passed=loaded.isValid() and len(loaded.Solids())==1 and diff<1e-3,
                       symmetric_difference_mm3=diff,sha256=hashlib.sha256(p.read_bytes()).hexdigest()))
    reader=vtk.vtkSTLReader();reader.SetFileName(str(m.OUT/(name+'.stl')));reader.Update()
    clean=vtk.vtkCleanPolyData();clean.SetInputConnection(reader.GetOutputPort());clean.Update()
    edges=vtk.vtkFeatureEdges();edges.SetInputConnection(clean.GetOutputPort())
    edges.BoundaryEdgesOn();edges.NonManifoldEdgesOn();edges.FeatureEdgesOff();edges.ManifoldEdgesOff();edges.Update()
    count=edges.GetOutput().GetNumberOfCells()
    checks.append(dict(name=name+' STL',passed=count==0 and clean.GetOutput().GetNumberOfCells()>0,
                       open_or_nonmanifold_edges=count))
    print(name,'difference',round(diff,7),'open edges',count,flush=True)
result=dict(passed=all(c['passed'] for c in checks),check_count=len(checks),checks=checks,
            source_sha256=hashlib.sha256(Path(m.__file__).read_bytes()).hexdigest())
(m.ROOT/'export_validation.json').write_text(json.dumps(result,indent=2))
raise SystemExit(0 if result['passed'] else 1)
