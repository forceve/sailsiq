import importlib.util
import json
import shutil
import sys
import tempfile
from pathlib import Path
import cadquery as cq

out=Path(__file__).resolve().parent
src=out.parents[1]/'硬件'/'trace-compass'/'v1'
spec=importlib.util.spec_from_file_location('trace_verify',src/'trace_compass_v1_enclosure.py')
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
result={}
for suffix,fn in [('one_piece_shell',m.make_unibody_shell),('bonded_front_panel',m.make_bonded_face_panel),('continuous_panel_adhesive_seal',m.make_panel_adhesive),('top_edge_silicone_buttons',m.make_silicone_buttons)]:
    with tempfile.TemporaryDirectory(prefix='compass_audit_') as temp:
        path=Path(temp)/'part.step'
        shutil.copyfile(src/'cadquery_out'/f'trace_compass_v1_{suffix}.step',path)
        exported=cq.importers.importStep(str(path)).val()
    source=fn().val()
    delta=source.cut(exported).Volume()+exported.cut(source).Volume()
    result[suffix]={'exported_valid':exported.isValid(),'symmetric_difference_mm3':delta,'matches_at_1e-4_mm3':delta<1e-4}
(out/'export-verification.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result,indent=2))
