"""Read-only CAD audit; renders source geometry without changing product files."""
import importlib.util
import json
import sys
from pathlib import Path

import cadquery as cq
import vtk

OUT = Path(__file__).resolve().parent
SOURCE = OUT.parents[1] / '硬件' / 'trace-compass' / 'v1' / 'trace_compass_v1_enclosure.py'
spec = importlib.util.spec_from_file_location('trace_audit_source', SOURCE)
m = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = m
spec.loader.exec_module(m)
p = m.P

parts = {
    'shell': m.make_unibody_shell().val(),
    'panel': m.make_bonded_face_panel().val(),
    'adhesive': m.make_panel_adhesive().val(),
    'lcd': m.make_lcd_module_reference().val(),
    'buttons': m.make_silicone_buttons().val(),
    'display': m.make_display_visual().val(),
}

def bbox(s):
    b = s.BoundingBox()
    return {key: round(getattr(b,key),5) for key in ['xmin','xmax','ymin','ymax','zmin','zmax']}

metrics = {'source':str(SOURCE),'parts':{},'intersections_mm3':{}}
for name, shape in parts.items():
    metrics['parts'][name] = {'valid':shape.isValid(),'volume_mm3':shape.Volume(),'bbox':bbox(shape)}
for a,b in [('shell','lcd'),('shell','panel'),('shell','adhesive'),('shell','buttons'),('panel','adhesive')]:
    overlap = parts[a].intersect(parts[b])
    metrics['intersections_mm3'][f'{a}/{b}'] = round(overlap.Volume(),6)
    if a=='shell' and b=='lcd': parts['lcd_collision'] = overlap
    if a=='shell' and b=='panel': parts['panel_collision'] = overlap

board_z = m.board_z_offset()
metrics['nominal'] = {
    'opening_mm':m.service_opening_size(),
    'lcd_mm':[p.lcd_module_w,p.lcd_module_h,p.lcd_t],
    'pcb_bottom_z':board_z,
    'support_top_z':p.floor+p.board_support_h,
    'support_gap_mm':board_z-(p.floor+p.board_support_h),
    'retaining_rib_to_board_lateral_gap_mm':p.board_edge_clearance-p.board_retain_rib_w,
    'button_hole_y_end':p.body_h/2+1-(p.wall+2),
    'cavity_top_y':m.service_opening_size()[1]/2,
    'button_blind_wall_remaining_mm':p.body_h/2+1-(p.wall+2)-m.service_opening_size()[1]/2,
    'silicone_inner_end_y':p.body_h/2-p.wall,
    'adhesive_bottom_z':m.panel_z()-p.adhesive_t,
    'recess_floor_z':p.body_t-p.panel_t-p.panel_recess_extra_depth,
}
(OUT/'measurements.json').write_text(json.dumps(metrics,indent=2),encoding='utf-8')
print(json.dumps(metrics,indent=2),flush=True)

colors={'shell':(0.29,0.34,0.37),'panel':(0.065,0.075,0.085),'adhesive':(0.98,0.64,0.12),'lcd':(0.15,0.52,0.56),'buttons':(0.48,0.53,0.55),'display':(0.87,0.88,0.78),'lcd_collision':(0.96,0.17,0.12),'panel_collision':(0.78,0.16,0.62),'pcb_envelope':(0.2,0.56,0.34)}

def actor(shape,name):
    verts,triangles=shape.tessellate(0.08,0.15)
    pts=vtk.vtkPoints()
    for v in verts: pts.InsertNextPoint(v.x,v.y,v.z)
    cells=vtk.vtkCellArray()
    for tri in triangles:
        cells.InsertNextCell(3)
        for i in tri: cells.InsertCellPoint(i)
    poly=vtk.vtkPolyData(); poly.SetPoints(pts); poly.SetPolys(cells)
    norms=vtk.vtkPolyDataNormals(); norms.SetInputData(poly); norms.SetFeatureAngle(45)
    mapper=vtk.vtkPolyDataMapper(); mapper.SetInputConnection(norms.GetOutputPort())
    a=vtk.vtkActor(); a.SetMapper(mapper); a.GetProperty().SetColor(colors[name]); a.GetProperty().SetInterpolationToPhong()
    return a

def render(filename,items,title,subtitle,position=(145,-175,200),viewup=(0,1,0),scale=72):
    renderer=vtk.vtkRenderer(); renderer.SetBackground(0.94,0.95,0.96)
    for name,shape in items: renderer.AddActor(actor(shape,name))
    for text,y,size in [(title,845,27),(subtitle,807,17)]:
        t=vtk.vtkTextActor();t.SetInput(text);t.SetPosition(35,y);t.GetTextProperty().SetFontSize(size);t.GetTextProperty().SetColor(0.12,0.18,0.22);renderer.AddActor2D(t)
    camera=renderer.GetActiveCamera();camera.SetPosition(*position);camera.SetFocalPoint(0,0,8);camera.SetViewUp(*viewup);camera.ParallelProjectionOn();camera.SetParallelScale(scale)
    renderer.ResetCameraClippingRange()
    win=vtk.vtkRenderWindow();win.SetOffScreenRendering(1);win.SetSize(1280,900);win.AddRenderer(renderer);win.SetMultiSamples(4);win.Render()
    grab=vtk.vtkWindowToImageFilter();grab.SetInput(win);grab.ReadFrontBufferOff();grab.Update()
    writer=vtk.vtkPNGWriter();writer.SetFileName(str(OUT/filename));writer.SetInputConnection(grab.GetOutputPort());writer.Write();win.Finalize()
    print('Rendered '+filename,flush=True)

render('01-front.png',[(n,parts[n]) for n in ['shell','panel','display','buttons']],
       '01  FRONT / CONTROL LAYOUT','Current source CAD | 112 x 86 x 18 mm | No UI, labels or finishes simulated',position=(0,0,240),scale=62)
render('02-open-shell.png',[(n,parts[n]) for n in ['shell','buttons']],
       '02  OPEN SHELL','Actual shell geometry | front opening 96 x 70 mm',position=(140,-170,230),scale=70)
clip=m._box(-80,80,-0.7,0.7,-2,25).val()
render('03-lcd-section.png',[(n,parts[n].intersect(clip)) for n in ['shell','lcd','panel','adhesive','lcd_collision']],
       '03  LCD / BOND SECTION (Y = 0)','Teal: LCD | Orange: adhesive | Red: LCD-shell intersection',position=(0,-240,8),viewup=(0,0,1),scale=45)
detail=m._box(43,57,-0.7,0.7,12,19).val()
render('03b-bond-detail.png',[(n,parts[n].intersect(detail).translate((-50,0,-7))) for n in ['shell','lcd','panel','adhesive','lcd_collision','panel_collision']],
       '03B  RIGHT EDGE DETAIL','Red: LCD collision | Magenta: panel collision | Orange: adhesive',position=(0,-240,8),viewup=(0,0,1),scale=9)
clip2=m._box(-25.7,-24.3,28,49,3,16).val()
render('04-button-section.png',[(n,parts[n].intersect(clip2).translate((25,-38,-1))) for n in ['shell','buttons']],
       '04  TOP BUTTON SECTION (X = -25)','Hole is blind | 4.2 mm solid wall remains before the cavity',position=(200,0,0),viewup=(0,0,1),scale=14)
# PCB outline only: explicitly a dimensional envelope, not a replacement board model.
b=m._centered_xy(p.board)
pcb=m._box(b.xmin,b.xmax,b.ymin,b.ymax,board_z,board_z+p.board.zmax).val()
clip3=m._box(-34.7,-33.3,-40,40,0,10).val()
render('05-pcb-support-section.png',[('shell',parts['shell'].intersect(clip3).translate((34,0,0))),('pcb_envelope',pcb.intersect(clip3).translate((34,0,0)))],
       '05  PCB SUPPORT SECTION (X = -34)','Green: measured PCB outline envelope | 0.95 mm gap above support pads',position=(240,0,6),viewup=(0,0,1),scale=48)
