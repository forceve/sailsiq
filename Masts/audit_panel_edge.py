"""Measure the exported V3.1 edge; does not modify production geometry."""
from pathlib import Path
import json
import sys
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import cadquery as cq
from validate_mast_sections import load_models

OUT = Path(__file__).resolve().parent/'cadquery_out/edge_audit'
OUT.mkdir(exist_ok=True)
rows = []
fig, ax = plt.subplots(figsize=(9, 6))
for model in load_models():
    p = model.P
    prefix = model.__name__.split('_')[0]
    solid = cq.Shape.importBrep(str(Path(__file__).resolve().parent/'cadquery_out/tree_v31'/f'{prefix}_tree_bracing_mount.brep'))
    def spans(x, dz):
        ray = cq.Edge.makeLine((x, p.plate_back_y-25, p.mount_center_z+dz),
                              (x, p.plate_back_y+4, p.mount_center_z+dz))
        return sorted([[e.BoundingBox().ymin-p.plate_back_y,
                        e.BoundingBox().ymax-p.plate_back_y] for e in solid.intersect(ray).Edges()])
    zs = np.arange(-59, 59.01, .5)
    xs = p.plate_w/2-.01
    depth = [-min(v[0] for v in spans(xs,float(z))) for z in zs]
    fine = {str(z): spans(p.plate_w/2,z) for z in (9.999,10,10.001,33.999,34,46,57.999,58,58.001)}
    row = {'model':prefix, 'revision':'tree-v3.1', 'probe_x_mm':xs,
           'z_relative_mm':zs.tolist(),'rear_projection_from_nominal_panel_mm':depth,
           'outer_edge_fine_spans_relative_to_panel_back_mm':fine,
           'fan_peak_z_relative_mm':34,'branch_last_station_z_relative_mm':46}
    rows.append(row)
    ax.plot(zs,depth,label=prefix,alpha=.75)
    print(prefix, json.dumps(fine),flush=True)
    if prefix == 'j80':
        # Explicitly cropped inspection samples. Cut faces are not original surfaces.
        for name,origin,size in (
            ('right_edge',(66,p.plate_back_y-18,536),(19,22,128)),
            ('fan_end',(82.45,p.plate_back_y-.15,609.4),(.6,1,1.3))):
            box=cq.Solid.makeBox(*size,cq.Vector(*origin))
            solid.intersect(box).exportBrep(str(OUT/f'j80_{name}.brep'))
ax.axhline(0,color='black',lw=.7,label='Nominal panel back')
ax.axvline(34,color='gray',ls=':',lw=.8)
ax.axvline(46,color='gray',ls='--',lw=.8)
ax.annotate('Fan peak: 11.85 mm\nz = +34 mm',xy=(34,11.85),xytext=(0,9),arrowprops={'arrowstyle':'->'})
ax.annotate('Branch terminal centre\nz = +46 mm',xy=(46,5.85),xytext=(24,2.5),arrowprops={'arrowstyle':'->'})
ax.set(xlabel='Height relative to panel centre (mm)',ylabel='Projection towards mast (mm)',
       title='Actual BREP edge section at X = +82.99 mm\nAll three models overlap; this is a real thickness profile')
ax.grid(alpha=.2);ax.legend(loc='upper left');fig.tight_layout()
fig.savefig(OUT/'edge_profile.png',dpi=180)
(OUT/'measurements.json').write_text(json.dumps(rows,indent=2),encoding='utf-8')
