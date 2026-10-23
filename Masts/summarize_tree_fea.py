"""Recheck solver force/moment balance and plot the actual comparison."""
import json
from compare_tree_fea import OUT, read_results
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

for variant in ('v1', 'v2', 'v2_final'):
    for h in (4, 3):
        read_results(f'{variant}_h{h}')
summary = []
for i, case in enumerate(('Fx', 'Fy', 'Fz', 'Mz')):
    row = {'case': case}
    for variant in ('v1', 'v2', 'v2_final'):
        a = json.loads((OUT/f'{variant}_h4_results.json').read_text())[i]['compliance_Nmm']
        b = json.loads((OUT/f'{variant}_h3_results.json').read_text())[i]['compliance_Nmm']
        row[variant] = {'h4_compliance_Nmm': a, 'h3_compliance_Nmm': b,
                        'refinement_change_percent': (b/a-1)*100}
    for variant, label in (('v2_final','final'),('v2','slim')):
        row[f'{label}_vs_v1_compliance_change_percent'] = (row[variant]['h3_compliance_Nmm']/row['v1']['h3_compliance_Nmm']-1)*100
    summary.append(row)
(OUT/'comparison.json').write_text(json.dumps({'scope': 'Exploratory J80 only; isotropic E=1000 MPa, nu=.35; rigid inner strap bands; no strength rating', 'cases': summary}, indent=2))
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 11})
x = np.arange(4)
fig, ax = plt.subplots(figsize=(9,4.4), layout='constrained')
a = [r['v2']['h3_compliance_Nmm']/r['v1']['h3_compliance_Nmm'] for r in summary]
b = [r['v2_final']['h3_compliance_Nmm']/r['v1']['h3_compliance_Nmm'] for r in summary]
ax.bar(x-.18,a,.34,label='Slim candidate (rejected)',color='#bdb5a5')
ax.bar(x+.18,b,.34,label='Final V2',color='#197e80')
ax.axhline(1,color='#465366',linestyle='--',label='V1 reference = 1')
ax.set_xticks(x,['Lateral Fx','Panel-normal Fy','Vertical Fz','Mast-axis torque Mz'])
ax.set_ylim(0,1.65)
ax.set_ylabel('Compliance / V1 (lower is stiffer)')
ax.set_title('J80: material redistribution at nearly equal total volume',loc='left',weight='bold',pad=18)
ax.legend(loc='upper left',ncol=3,fontsize=9)
ax.spines[['top','right']].set_visible(False)
for i,v in enumerate(b):
    ax.text(i+.18,v+.035,f'{(v-1)*100:.1f}%',ha='center',color='#126367')
fig.text(.01,-.045,'Exploratory linear FEA, h=3 mm; isotropic reference material and idealized supports. No strength rating.',fontsize=9,color='#5c6573')
fig.savefig(OUT/'compliance_comparison.png',dpi=180,bbox_inches='tight')
plt.close(fig)
print(json.dumps(summary,indent=2))
