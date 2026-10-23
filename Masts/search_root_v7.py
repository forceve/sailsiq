"""Bounded root candidates; only geometrically checked results are accepted."""
import json
from pathlib import Path
from validate_mast_sections import load_models
from branch_junction import build as fork
from root_blend_v7 import build
from validate_root_blend_v7 import validate_root

out=Path(__file__).resolve().parent/'cadquery_out/v7_experiments'
m=load_models()[0]
for rear,offset,shear in [(26,3,.7),(28,3,.7),(24,3,.7),(22,3,.7),(26,1,.7),(24,1,.7),(24,5,.4),(26,5,.4),(28,5,.4),(24,3,.4),(26,3,.4),(28,3,.4)]:
    params={'central_rear_y':rear,'neck_center_offset':offset,'central_shear':shear}
    f=fork(m,params,measure=False)
    for radius in (4.,3.,5.,2.):
        try:
            r=build(m,fork_geometry=f,radius=radius)
            check=validate_root(m,r['shell_and_supports'])
            print(params,radius,check['minimum_principal_radius_mm'],check['maximum_boundary_normal_angle_deg'],check['passed'],flush=True)
            if check['passed']:
                r['shell_and_supports'].exportBrep(str(out/'fareast23r_accepted_root.brep'))
                (out/'fareast23r_accepted_root.json').write_text(json.dumps({'params':params,'radius':radius,'check':check},indent=2))
                raise SystemExit(0)
        except Exception as e:print(params,radius,type(e).__name__,str(e)[:110],flush=True)
raise SystemExit(2)
