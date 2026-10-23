"""Photo-based metrology, not an engineering drawing or an image retouch.

Four manually inspected outer corners define a perspective transform onto the
manufacturer's labelled 67.6 x 91 mm rectangle. Boundary ambiguity remains.
"""
from pathlib import Path
import json
import math
import shutil
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon, Rectangle

OUT=Path(__file__).resolve().parent
SOURCE=Path(r'C:\Users\MSI-NB\AppData\Local\Temp\codex-clipboard-b668c3af-2a71-439e-901d-40680f0e0d33.png')
if SOURCE.exists(): shutil.copyfile(SOURCE,OUT/'source.png')
src=np.array([[383,167],[903,169],[893,855],[390,855]],float)
dst=np.array([[0,0],[67.6,0],[67.6,91],[0,91]],float)
face=np.array([[399,181],[887,183],[879,823],[404,822]],float)
a=[];b=[]
for (x,y),(u,v) in zip(src,dst):
    a.extend([[x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y]])
    b.extend([u,v])
H=np.append(np.linalg.solve(a,b),1).reshape(3,3)
def project(points):
    q=np.c_[points,np.ones(len(points))]@H.T
    return q[:,:2]/q[:,2:]
q=project(face)
left=q[[0,3],0].mean();right=67.6-q[[1,2],0].mean()
top=q[:2,1].mean();bottom=91-q[2:,1].mean()
centre=np.array([(left+67.6-right)/2,(top+91-bottom)/2])
# Current code uses landscape 88 x 66, equivalently portrait 66 x 88.
current=np.array([66.0,88.0]);proposed=np.array([65.2,86.4])
current_lo=centre-current/2;current_hi=centre+current/2
proposal_lo=centre-proposed/2;proposal_hi=centre+proposed/2
angles={}
for name,margins,gap,float_xy in [
    ('v2_nominal',[1.6,1.2],1.605,0),
    ('v2_at_0p75mm_float',[1.6,1.2],1.605,.75),
    ('narrow_window_at_original_gap',[.8,.8],1.605,0),
    ('candidate_small_gap_and_tight_location',[.8,.8],.5,.25),
]:
    angles[name]=[math.degrees(math.atan((m-float_xy)/gap)) for m in margins]
data={
 'source':'source.png','method':'manual outer/display-face corners; perspective mapping to 67.6 x 91 mm',
 'outer_corners_pixels':src.tolist(),'display_face_corners_pixels':face.tolist(),
 'perspective_matrix':H.tolist(),'photo_face_mm':[67.6-left-right,91-top-bottom],
 'photo_border_portrait_mm':dict(left=left,right=right,top_non_fpc=top,bottom_fpc=bottom),
 'display_centre_offset_from_module_centre_mm':(centre-[33.8,45.5]).tolist(),
 'current_window_landscape_mm':[88,66],
 'current_remaining_module_cover_portrait_mm':dict(left=current_lo[0],right=67.6-current_hi[0],top_non_fpc=current_lo[1],bottom_fpc=91-current_hi[1]),
 'candidate_window_landscape_mm':[86.4,65.2],
 'candidate_remaining_module_cover_portrait_mm':dict(left=proposal_lo[0],right=67.6-proposal_hi[0],top_non_fpc=proposal_lo[1],bottom_fpc=91-proposal_hi[1]),
 'geometric_clipping_onset_degrees_landscape_xy':angles,
 'limits':['Face boundary estimated, not pixel AA metrology. Border estimates report approximately +/-0.3 to 0.5 mm visual uncertainty, not a statistical tolerance.',
           'Photo shows bare 91 x 67.6 mm module plus FPC, not the earlier 99.7 x 69.34 mm carrier PCB.',
           'Perspective correction assumes planar rectangle and trustworthy printed dimensions.',
           'Sightline model is an air-gap geometric estimate to inner lens mask, not an LCD viewing-angle or optical qualification.',
           'Current 1.95 mm PCB offset cannot be transferred directly to bare-module placement.',
           'Candidate dimensions are a proposal; no product CAD files modified.']}
(OUT/'measurements.json').write_text(json.dumps(data,indent=2),encoding='utf-8')

fig,(ax,bx)=plt.subplots(1,2,figsize=(15,9),gridspec_kw={'width_ratios':[1,1.1]})
fig.patch.set_facecolor('#f5f6f7')
im=plt.imread(OUT/'source.png');ax.imshow(im)
ax.add_patch(Polygon(src,fill=False,edgecolor='#ed7a27',linewidth=2.4,label='Labelled module outline'))
ax.add_patch(Polygon(face,fill=False,edgecolor='#1ed1ce',linewidth=2,label='Estimated display-face boundary'))
ax.set_xlim(345,940);ax.set_ylim(890,140);ax.set_aspect('equal');ax.axis('off')
ax.set_title('PHOTO MEASUREMENT\n67.6 x 91 mm scale; FPC points downward',loc='left',fontsize=13)
ax.legend(loc='lower center',fontsize=9,framealpha=.96)
bx.add_patch(Rectangle((0,0),67.6,91,facecolor='#30393c',edgecolor='#ed7a27',linewidth=2,label='Bare module 67.6 x 91'))
bx.add_patch(Rectangle((left,top),67.6-left-right,91-top-bottom,facecolor='#b8d9da',edgecolor='#17aaa8',linewidth=1.5,label='Estimated display face ~63.6 x 84.8'))
bx.add_patch(Rectangle(current_lo,*current,fill=False,edgecolor='#e34a33',linewidth=2.2,label='Current window: 66 x 88 portrait'))
bx.add_patch(Rectangle(proposal_lo,*proposed,fill=False,edgecolor='#2378b5',linestyle='--',linewidth=1.8,label='Candidate: 65.2 x 86.4 portrait'))
bx.annotate('Only ~0.2 mm cover\nat the non-FPC end',xy=(centre[0],current_lo[1]),xytext=(34,-12),ha='center',fontsize=11,color='#b93324',arrowprops=dict(arrowstyle='->',color='#b93324'))
bx.text(33.8,89.4,'FPC',ha='center',va='center',fontsize=8,color='white')
bx.text(33.8,50,'Estimated display face\n63.6 x 84.8 mm\n\n~2.0 mm border each side',ha='center',va='center',fontsize=12,color='#213a40')
bx.set_xlim(-7,75);bx.set_ylim(104,-19);bx.set_aspect('equal');bx.axis('off')
bx.set_title('WINDOW OVERLAY / PORTRAIT\nBoth windows aligned to the estimated display centre',loc='left',fontsize=13)
bx.legend(loc='lower center',bbox_to_anchor=(.5,-.04),fontsize=9,framealpha=.96)
fig.text(.035,.022,'Photo-derived estimates, not manufacturing dimensions. Measurement uncertainty roughly 0.3-0.5 mm. No CAD changes.',fontsize=10,color='#52616a')
fig.subplots_adjust(left=.025,right=.98,top=.9,bottom=.11,wspace=.12)
fig.savefig(OUT/'window-audit.png',dpi=160,facecolor=fig.get_facecolor())
print(json.dumps(data,indent=2))
