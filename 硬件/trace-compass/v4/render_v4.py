"""Render actual CAD and PCB solids; colored allocations are explicitly provisional."""
from pathlib import Path
import vtk
from PIL import Image
import trace_compass_v4 as m
OUT=m.ROOT/'previews'

def actor(shape,color,alpha=1):
    verts,tris=shape.tessellate(.07,.16)
    points=vtk.vtkPoints()
    for v in verts:points.InsertNextPoint(v.x,v.y,v.z)
    faces=vtk.vtkCellArray()
    for tri in tris:
        faces.InsertNextCell(3)
        for i in tri:faces.InsertCellPoint(i)
    poly=vtk.vtkPolyData();poly.SetPoints(points);poly.SetPolys(faces)
    norms=vtk.vtkPolyDataNormals();norms.SetInputData(poly);norms.SetFeatureAngle(35)
    mapper=vtk.vtkPolyDataMapper();mapper.SetInputConnection(norms.GetOutputPort())
    a=vtk.vtkActor();a.SetMapper(mapper);p=a.GetProperty();p.SetColor(*color)
    p.SetOpacity(alpha);p.SetAmbient(.25);p.SetDiffuse(.75);p.SetSpecular(.12)
    return a

def caption(r,s,x,y,size=23):
    a=vtk.vtkTextActor();a.SetInput(s);a.SetPosition(x,y)
    a.GetTextProperty().SetColor(.12,.19,.21);a.GetTextProperty().SetFontSize(size)
    r.AddActor2D(a)

def text3d(s,x,y,z,h):
    v=vtk.vtkVectorText();v.SetText(s);v.Update();b=v.GetOutput().GetBounds()
    scale=h/(b[3]-b[2]);mapper=vtk.vtkPolyDataMapper();mapper.SetInputConnection(v.GetOutputPort())
    a=vtk.vtkActor();a.SetMapper(mapper);a.SetScale(scale,scale,scale)
    a.SetPosition(x-b[0]*scale,y-b[2]*scale,z);a.GetProperty().SetColor(.03,.05,.05);a.GetProperty().LightingOff()
    return a

def render(filename,items,title,subtitle,pos=(150,170,300),focal=(0,0,15),scale=96,screen=False,show_routes=False):
    r=vtk.vtkRenderer();r.SetBackground(.96,.958,.945)
    r.SetUseDepthPeeling(True);r.SetMaximumNumberOfPeels(80);r.SetOcclusionRatio(.02)
    for name,s,alpha in items:
        if hasattr(s,'val'):s=s.val()
        if name.startswith('PCB_'):
            solids=s.Solids();substrate=max(solids,key=lambda s:s.Volume())
            r.AddActor(actor(substrate,m.COLORS[name],alpha))
            # Keep all actual imported geometry; combine component pieces for speed.
            import cadquery as cq
            components=[q for q in solids if not q.isSame(substrate)]
            r.AddActor(actor(cq.Compound.makeCompound(components),(.28,.30,.32),alpha))
        else:r.AddActor(actor(s,m.COLORS[name],alpha))
    if screen:
        for args in [('HEADING',-34,31,31.14,4),('278',-33,0,31.14,25),('deg',24,-10,31.14,4),('COMPASS',-34,-12,31.14,3.2)]:r.AddActor(text3d(*args))
    if show_routes:
        for name,route in m.cable_routes().items():
            pts=vtk.vtkPoints()
            for p in route['points']:pts.InsertNextPoint(*p)
            line=vtk.vtkPolyLine();line.GetPointIds().SetNumberOfIds(len(route['points']))
            for i in range(len(route['points'])):line.GetPointIds().SetId(i,i)
            cells=vtk.vtkCellArray();cells.InsertNextCell(line)
            data=vtk.vtkPolyData();data.SetPoints(pts);data.SetLines(cells)
            mapper=vtk.vtkPolyDataMapper();mapper.SetInputData(data)
            a=vtk.vtkActor();a.SetMapper(mapper);a.GetProperty().SetColor(.90,.38,.09);a.GetProperty().SetLineWidth(3)
            r.AddActor(a)
    r.AutomaticLightCreationOff()
    for xyz,intensity in [((-180,230,300),.9),((220,50,130),.45),((-100,-180,-120),.35)]:
        l=vtk.vtkLight();l.SetPosition(xyz[0],xyz[1],-xyz[2] if pos[2]<0 else xyz[2]);l.SetFocalPoint(*focal);l.SetIntensity(intensity);r.AddLight(l)
    l=vtk.vtkLight();l.SetLightTypeToHeadlight();l.SetIntensity(.3);r.AddLight(l)
    cam=r.GetActiveCamera();cam.SetPosition(*pos);cam.SetFocalPoint(*focal);cam.SetViewUp(0,1,0);cam.ParallelProjectionOn();cam.SetParallelScale(scale)
    r.ResetCameraClippingRange()
    caption(r,title,55,90,28);caption(r,subtitle,55,48,19)
    win=vtk.vtkRenderWindow();win.SetOffScreenRendering(1);win.SetAlphaBitPlanes(1);win.SetMultiSamples(0);win.SetSize(1800,1600);win.AddRenderer(r);win.Render()
    grab=vtk.vtkWindowToImageFilter();grab.SetInput(win);grab.ReadFrontBufferOff();grab.Update()
    writer=vtk.vtkPNGWriter();writer.SetFileName(str(OUT/filename));writer.SetInputConnection(grab.GetOutputPort());writer.Write();win.Finalize()
    print('Rendered '+filename,flush=True)

def main():
    OUT.mkdir(exist_ok=True)
    parts={**m.manufactured(),**m.references(),'PRINT_MASK_VISUAL':m.mask(),
           'AA_VISUAL':m.rect(84.8,63.6,.015,31.1,0,10),'LCD_FPC_ROUTE':m.screen_fpc()[0]}
    primary=parts['silicone_keypad'].intersect(m.rect(24,19,5,30.4,m.KEY_X[-1],m.KEY_Y))
    parts['silicone_keypad']=parts['silicone_keypad'].cut(primary)
    parts['PRIMARY_KEY_VISUAL']=primary
    m.COLORS['PRIMARY_KEY_VISUAL']=(.95,.30,.07)
    marks=parts['silicone_keypad'].intersect(m.rect(120,25,1,33.6001,0,m.KEY_Y))
    parts['silicone_keypad']=parts['silicone_keypad'].cut(m.rect(120,25,1,33.6001,0,m.KEY_Y))
    parts['KEY_MARKS_VISUAL']=marks
    m.COLORS['KEY_MARKS_VISUAL']=(.65,.72,.70)
    items=[(n,s,.08 if n=='protective_lens' else 1) for n,s in parts.items()]
    render('01-front-isometric.png',items,'TRACE COMPASS / V4','134 x 144 x 33.2 mm body | Component-led layout | Screen upright',screen=True)
    # Cut front skin away visually; all electronic models retain their real placement.
    hide={'front_housing','protective_lens','lens_adhesive','PRINT_MASK_VISUAL','AA_VISUAL','LCD_91x67p6_REFERENCE','lcd_support_tray','lcd_rear_cushion','lcd_front_spacer','silicone_keypad','keypad_clamp','PRIMARY_KEY_VISUAL','KEY_MARKS_VISUAL'}
    internal=[(n,s,.35 if 'ALLOCATION' in n else 1) for n,s in parts.items() if n not in hide]
    render('02-component-layout.png',internal,'INTERNAL LAYOUT / FRONT OPEN','Real PCB STEP models | Amber: GNSS | Blue: battery | Copper: thin charger',pos=(120,200,340),scale=94,show_routes=True)
    rear=[(n,s,.35 if 'ALLOCATION' in n else 1) for n,s in parts.items() if n!='rear_cover']
    render('03-rear-service.png',rear,'REAR ACCESS / REMOVABLE CARRIERS','Battery and charger: lowest-priority adjustable allocations | MMU: polymer side guide',pos=(-160,190,-330),scale=96)
    offsets={'rear_cover':-105,'PCB_BAT_REFERENCE':-105,'rear_gasket_ASSEMBLED':-90,'WIRELESS_50x50x2_ALLOCATION':-75,'BATTERY_80x62x7_ALLOCATION':-60,
       'mcu_carrier':-40,'PCB_MCU_REFERENCE':-27,'sw_carrier':-35,'PCB_SW_REFERENCE':-18,'keypad_clamp':-15,
       'lcd_support_tray':28,'lcd_rear_cushion':34,'LCD_91x67p6_REFERENCE':42,'lcd_front_spacer':47,
       'protective_lens':60,'PRINT_MASK_VISUAL':60,'AA_VISUAL':42,'lens_adhesive':55,'silicone_keypad':24,'PRIMARY_KEY_VISUAL':24,'KEY_MARKS_VISUAL':24}
    exploded=[]
    for n,s in parts.items():
        if n=='LCD_FPC_ROUTE':continue
        exploded.append((n,s.translate((0,0,offsets.get(n,0))),.10 if n=='protective_lens' else .7 if 'ALLOCATION' in n else 1))
    render('04-exploded.png',exploded,'ASSEMBLY / ALL BOARDS AND SUPPORTS','References and allocations are not print parts | No external USB openings',pos=(260,180,140),focal=(0,0,-10),scale=141)
    sheet=Image.new('RGB',(1848,1696),(245,244,241))
    for i,n in enumerate(('01-front-isometric.png','02-component-layout.png','03-rear-service.png','04-exploded.png')):
        im=Image.open(OUT/n).convert('RGB');im.thumbnail((900,800));sheet.paste(im,(12+(i%2)*924,12+(i//2)*848))
    sheet.save(OUT/'00-layout-overview.jpg',quality=94)

if __name__=='__main__':main()
