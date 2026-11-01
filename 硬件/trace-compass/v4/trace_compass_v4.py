"""V4 component-led enclosure. mm; X right, Y sky, Z towards viewer.

Intended use: screen vertical. Imported electronics are reference models, not
print parts. Unselected battery / wireless charger remain allocation envelopes.
"""
from pathlib import Path
from functools import cache
import json, hashlib
import cadquery as cq

ROOT=Path(__file__).resolve().parent
SOURCE=ROOT.parents[1]/'compass元件设计文件'
if not SOURCE.exists(): SOURCE=ROOT/'references'
OUT=ROOT/'cadquery_out'
W,H,T=134.,144.,33.2
REAR=3.; WALL=2.8; CEILING=30.4
SCREEN_Y=10.; LCD_X=1.6; LCD_FRONT=31.1; LCD_T=.725
LENS_Z=31.6
KEY_X=(-38.4989,-13.5002,11.501,38.5012)
KEY_W=(18,18,18,22)
KEY_Y=-42.9987
REAR_SCREWS=((-60,-65),(60,-65),(-60,65),(60,65))
CARRIER_SCREWS=((-3,-29.25),(60.5,-29.25),(-3,49.5),(60.5,49.5))
LCD_SCREWS=((-55,-15),(55,-15),(-55,35),(55,35))
MCU_HOLES=((5,5),(55.0001,5),(5,62.0001),(55.0001,62.0001))
BAT_HOLES=((5,5),(20,5),(5,35.0001),(20,35.0001))
SW_HOLES=((5,5),(25.0001,5),(75.0001,5),(95.0002,5))

def rect(w,h,t,z=0,x=0,y=0):
    return cq.Workplane('XY').rect(w,h).extrude(t).translate((x,y,z))

def rounded(w,h,t,r,z=0,x=0,y=0):
    return cq.Workplane('XY').rect(w,h).extrude(t).edges('|Z').fillet(r).translate((x,y,z))

def cyl(d,t,z,x,y):
    return cq.Workplane('XY').circle(d/2).extrude(t).translate((x,y,z))

def union(items):
    s=items[0]
    for a in items[1:]:s=s.union(a)
    return s

def ring(ow,oh,iw,ih,t,ro,ri,z,x=0,y=0):
    return rounded(ow,oh,t,ro,z,x,y).cut(rounded(iw,ih,t+2,ri,z-1,x,y))

def bat_transform(s):
    # Bottom region of rear floor; native USB faces inward (+Y), not a wall.
    return s.rotate((0,0,0),(0,0,1),-90).translate((-50,-36,6))

def mmu_transform(s):
    # native x -> device y; native y -> device z; native top -> right (+X).
    return s.rotate((0,0,0),(1,1,1),120).translate((-60,15,12))

def transform(name,s):
    if name=='MCU':return s.translate((1,-24.5,18))
    if name=='SW':return s.translate((-50,-48,24))
    if name=='BAT':return bat_transform(s)
    if name=='MMU':return mmu_transform(s)
    raise ValueError(name)

@cache
def native(name):
    p=SOURCE/'PCB/pcbmodels'/f'PCB_{name}.step'
    cache_file=ROOT/'inspection'/f'{name}.brep'
    # Cache is verified against the input hash, never silently reused for new PCB.
    inventory=json.loads((ROOT/'inspection/pcb-datums.json').read_text())
    expected=inventory[name]['step_sha256']
    assert hashlib.sha256(p.read_bytes()).hexdigest()==expected, 'PCB changed: regenerate datums/cache'
    return cq.Shape.importBrep(str(cache_file)) if cache_file.exists() else cq.importers.importStep(str(p)).val()

@cache
def electronics():
    return {f'PCB_{n}_REFERENCE':transform(n,native(n)) for n in ('MCU','BAT','MMU','SW')}

def rear_gasket():
    # Assembled geometry only. Free thickness / squeeze NOT frozen.
    return ring(122.4,132.4,118.4,128.4,.7,8,6,3)

def rear_cover():
    s=rounded(W,H,3,12)
    for x,y in REAR_SCREWS:
        s=s.cut(cyl(3.2,4,-.5,x,y)).cut(cyl(5.6,1.3,0,x,y))
    # Battery and charger share an adjustable backplate allocation, not fixed cell pocket.
    for x in (-38,54):
        for y in (-25,33):
            s=s.union(rounded(4,7,1.7,1,3,x,y))
            s=s.cut(rect(1.6,5,1.2,3.3,x,y))  # reusable tie/strap anchor slot
    for x,y in BAT_HOLES:
        post=cyl(5.3,3,-3,x,y).cut(cyl(2.4,2.9,-2.8,x,y))
        s=s.union(bat_transform(post))
    return s

def mmu_channel():
    # Integral polymer back and guide rails. No metal studs, no use of tiny holes.
    back=rect(23,15,1.2,-1.2,10,6)
    rails=[rect(23,1,2.0,0,10,-.65),rect(23,1,2.0,0,10,12.65),
           rect(1.2,15,2,0,20.6,6),
           rect(23,.7,.55,1.85,10,-.05),rect(23,.7,.55,1.85,10,12.05)]
    s=mmu_transform(union([back]+rails))
    # Bridge to inner side wall, entirely behind the sensor board.
    return s.union(rect(3.1,23,15,10.5,-62.75,25))

def antenna_support():
    # Horizontal XZ support plane at Y=55. Adjustable 28 x 27 footprint.
    floor=rect(32,1.5,27.4,3,30,54.25)
    floor=floor.cut(rect(10,3,16,10,30,54.5))  # underside shield / coax relief
    left=rect(1.5,14.5,4,14.7,13.25,61.75)
    right=rect(1.5,14.5,4,14.7,46.75,61.75)
    # Small side stops; retention by removable nonmetal tape over inactive edges.
    stops=[rect(1.2,3,27.4,3,x,56.5) for x in (15.2,44.8)]
    # Connect legs to upper wall (inside top Y=69.2).
    left=left.union(rect(1.5,1,4,14.7,13.25,69))
    right=right.union(rect(1.5,1,4,14.7,46.75,69))
    return union([floor,left,right]+stops)

@cache
def shell():
    body=rounded(W,H,T-3,12,3)
    body=body.cut(rounded(W-2*WALL,H-2*WALL,CEILING-5.4,9.2,5.4))
    body=body.cut(rounded(117,127,3.5,4,2))
    body=body.cut(rounded(104.6,78.6,5,4,31.4,0,SCREEN_Y))
    body=body.cut(rect(94.2,70.8,7,28,LCD_X,SCREEN_Y))
    body=body.cut(rounded(8,18,2.8,1,28,50,SCREEN_Y))
    for x,w in zip(KEY_X,KEY_W):
        body=body.cut(rounded(w+1.2,18.2,5,3.2,29,x,KEY_Y))
    for x,y in REAR_SCREWS:
        # Side mid screws outside gasket: smaller tower avoids sensor board.
        body=body.union(cyl(6,CEILING-3,3,x,y))
        body=body.cut(cyl(2.4,10,2.9,x,y))
    for x,y in CARRIER_SCREWS:
        body=body.union(cyl(4.4,CEILING-15.3,15.3,x,y))
        body=body.cut(cyl(1.6,8,15.2,x,y))
    for x,y in LCD_SCREWS:
        body=body.union(cyl(5.2,CEILING-29.875,29.875,x,y))
        body=body.cut(cyl(1.6,2.7,29.775,x,y))
    # Separate rear carrier avoids putting front bosses through moving keycaps.
    for x in (-57,57):
        body=body.union(cyl(5.2,CEILING-21.5,21.5,x,-51))
        body=body.cut(cyl(1.6,6,21.4,x,-51))
    # Keypad flange is captured by a separate rear pressure frame.
    for x in (-57,57):
        body=body.union(cyl(5,.8,29.6,x,KEY_Y))
        body=body.cut(cyl(1.6,3,29.5,x,KEY_Y))
    body=body.union(mmu_channel()).union(antenna_support())
    for side in (-1,1):
        for z in (10,14,18,22,26):
            body=body.cut(rect(.6,48,.8,z,side*66.9,0))
    body=body.cut(ring(122.4,132.4,118.4,128.4,.72,8,6,2.99))
    return body

def mcu_carrier():
    plate=rounded(63,70,1.5,2,13.8,31.5,9)
    for x in (-3,60.5):
        plate=plate.union(rounded(6,87,1.5,2,13.8,x,9))
    for hx,hy in MCU_HOLES:
        x,y=hx+1,hy-24.5
        plate=plate.union(cyl(5.4,2.7,15.3,x,y))
        plate=plate.cut(cyl(2.4,4.1,13.9,x,y))
    for x,y in CARRIER_SCREWS:
        plate=plate.cut(cyl(2.3,3,13.2,x,y))
    # Connector through-pin reliefs are supplied by standoff height; large windows
    # reduce mass and expose the backplate battery without touching solder tails.
    for x in (15,44):
        plate=plate.cut(rounded(20,49,3,3,13,x,8))
    return plate

def lcd_tray():
    s=rounded(97,73,1.4,2,28.475,LCD_X,SCREEN_Y)
    # Tail is allowed to fold at the glass edge, never over the whole tray width.
    s=s.cut(rounded(10,18,5,1,28,50.5,SCREEN_Y))
    for x,y in LCD_SCREWS:
        sx=-49 if x<0 else 51
        s=s.union(rounded(abs(x-sx)+6,8,1.4,2,28.475,(x+sx)/2,y))
        s=s.cut(cyl(2.3,3,28,x,y))
    # Three sides plus split tail side locate bare LCD, not the old carrier PCB.
    for dy in (-34.55,34.55):
        s=s.union(rect(91.8,1.2,1.3,29.875,LCD_X,SCREEN_Y+dy))
    for dx in (-46.25,46.25):
        for dy in (-24,24):
            s=s.union(rect(1.2,14,1.3,29.875,LCD_X+dx,SCREEN_Y+dy))
    return s

def lcd_pad():
    return rect(91,67.6,.5,29.875,LCD_X,SCREEN_Y).cut(rect(10,18,2,29.5,50.5,SCREEN_Y))

def lcd_front_pad():
    return rounded(90.6,67.2,.5,.3,31.1,LCD_X,SCREEN_Y).cut(
        rounded(86.4,65.2,2,.5,30.5,0,SCREEN_Y))

def lens():return rounded(104,78,1.5,3.7,LENS_Z,0,SCREEN_Y)
def mask():return ring(103.6,77.6,86.4,65.2,.01,3.5,.5,31.605,0,SCREEN_Y)
def adhesive():
    return rounded(103.6,77.6,.2,3.5,31.4,0,SCREEN_Y).cut(rect(95.2,71.8,2,31,LCD_X,SCREEN_Y))

def keypad():
    pad=rounded(108,22,.8,3,29.6,0,KEY_Y)
    for i,(x,w) in enumerate(zip(KEY_X,KEY_W)):
        cap=rounded(w,17,3.2,3,30.4,x,KEY_Y)
        # Nominal .30 mm free gap to modeled switch top Z=30.50.
        stem=cyl(3.0,2,30.8,x,KEY_Y)
        pad=pad.union(cap).cut(rounded(w-3,14,4.6,1.5,28,x,KEY_Y)).union(stem)
        mark=cyl(2.4,.3,33.6,x,KEY_Y) if i==2 else (
            ring(6,6,3.6,3.6,.3,2.9,1.7,33.6,x,KEY_Y) if i==3 else
            rounded(5 if i==0 else 1.2,1.2 if i==0 else 5,.3,.5,33.6,x,KEY_Y))
        pad=pad.union(mark)
    return pad

def keypad_clamp():
    s=ring(118,24,104,18,1.5,4,2,28.1,0,KEY_Y)
    # Top bosses project into frame outside the sealed membrane flange.
    for x in (-57,57):
        s=s.cut(cyl(2.3,3,27.8,x,KEY_Y))
    for x in (-57,57):s=s.cut(cyl(5.6,3,27.8,x,-51))
    for x,y in CARRIER_SCREWS:s=s.cut(cyl(4.8,3,27.8,x,y))
    return s

def sw_carrier():
    s=rounded(106,14,1.5,2,20,0,-43)
    for x in (-57,57):
        s=s.union(rounded(8,8,1.5,2,20,x*.964,-49))
        s=s.cut(cyl(2.3,3,19.5,x,-51))
    for hx,hy in SW_HOLES:
        x,y=hx-50,hy-48
        s=s.union(cyl(5.5,2.5,21.5,x,y))
        s=s.cut(cyl(2.4,3.9,20.1,x,y))
    return s

def mmu_gate():
    # Bond gate to integral guide ends after insertion; no metallic hardware.
    return mmu_transform(rect(1.35,11.2,2.4,0,-.825,6))

@cache
def manufactured():
    return {'front_housing':shell(),'rear_cover':rear_cover(),
        'mcu_carrier':mcu_carrier(),'lcd_support_tray':lcd_tray(),
        'keypad_clamp':keypad_clamp(),'sw_carrier':sw_carrier(),'mmu_polymer_gate':mmu_gate(),
        'protective_lens':lens(),'lens_adhesive':adhesive(),
        'lcd_rear_cushion':lcd_pad(),'lcd_front_spacer':lcd_front_pad(),
        'silicone_keypad':keypad(),'rear_gasket_ASSEMBLED':rear_gasket()}

@cache
def references():
    return {**electronics(),
      'LCD_91x67p6_REFERENCE':rect(91,67.6,LCD_T,LCD_FRONT-LCD_T,LCD_X,SCREEN_Y).val(),
      'GNSS_28x27x8_ALLOCATION':rect(28,8,27,3.2,30,59).val(),
      'BATTERY_80x62x7_ALLOCATION':rect(80,62,7,5.8,10,4).val(),
      'WIRELESS_50x50x2_ALLOCATION':rect(50,50,2,3.5,8,4).val()}

def screen_fpc():
    # Swept strip through real MCU slot. 2 mm neutral bend radius is provisional.
    p=lambda x,z:cq.Vector(x,SCREEN_Y,z)
    es=[cq.Edge.makeLine(p(47.1,30.5),p(48,30.5)),
        cq.Edge.makeThreePointArc(p(48,30.5),p(49.41421356,29.91421356),p(50,28.5)),
        cq.Edge.makeLine(p(50,28.5),p(50,22.8)),
        cq.Edge.makeThreePointArc(p(50,22.8),p(49.41421356,21.38578644),p(48,20.8)),
        cq.Edge.makeLine(p(48,20.8),p(36.7,20.8))]
    path=cq.Wire.assembleEdges(es)
    profile=cq.Workplane(cq.Plane(origin=(47.1,SCREEN_Y,30.5),xDir=(0,1,0),normal=(1,0,0))).rect(6.5,.15)
    s=profile.sweep(cq.Workplane().newObject([path]),isFrenet=True)
    # Conservative wider root / component area, distinct from 6.5mm contact tail.
    root=cq.Workplane(cq.Plane(origin=(47.1,SCREEN_Y,30.5),xDir=(0,1,0),normal=(1,0,0))).rect(14,.15)
    s=s.union(root.sweep(cq.Workplane().newObject([cq.Wire.assembleEdges(es[:3])]),isFrenet=True))
    return s,path.Length()

def cable_routes():
    # Route allocations are not cable purchase specs. Endpoints from PCB datums.
    return {
      'MCU_MMU_FPC':{'width_mm':5,'points':[(20.304,-12.689,20.62),(20.304,-18,26),(-48,-18,26),(-54,17.032,26),(-57.38,17.032,18)]},
      'MCU_BAT_FPC':{'width_mm':5,'points':[(10.652,32.015,20.62),(-11,37,26),(-14,-34,26),(-13.805,-46.287,8.62)]},
      'SW_HARNESS':{'diameter_mm':3,'points':[(41.2081,-.243,22.95),(42,-30,24),(0,-35,27),(0,-40.78,27)]},
      'GNSS_COAX':{'diameter_mm':1.13,'points':[(30,55,16.7),(30,53.5,26),(56,53.5,26),(56,-7.482,26),(54.34,-7.482,20.5)]},
      'BATTERY_LEAD':{'diameter_mm':3,'points':[(-30,-20,9),(-33,-29,9),(-28,-32,14),(-28,-39.54,13.8)]},
      'WIRELESS_USB':{'diameter_mm':3,'points':[(-17,-15,4.5),(-26,-24,4.5),(-36.538,-21,8.8),(-36.538,-35.8,8.8)]}}

def service_spaces():
    # Short metal nose clears the board lip before the thicker overmold starts.
    debug=rect(9,3.5,2.6,19.7,45.45,42.45).union(rect(12,8.5,6,18,45.45,48.45))
    return {'MCU_USB_INSERTION':debug.val(),
            'BAT_USB_PLUG':rect(12,14,6,6,-36.538,-28.8).val()}

COLORS={'front_housing':(.72,.76,.75),'rear_cover':(.60,.65,.65),
 'mcu_carrier':(.38,.48,.56),'lcd_support_tray':(.50,.59,.62),
 'keypad_clamp':(.45,.52,.55),'sw_carrier':(.45,.52,.55),'mmu_polymer_gate':(.68,.50,.80),
 'protective_lens':(.70,.85,.88),'lens_adhesive':(.12,.15,.16),
 'lcd_rear_cushion':(.12,.60,.65),'lcd_front_spacer':(.12,.60,.65),
 'silicone_keypad':(.10,.14,.16),'rear_gasket_ASSEMBLED':(.12,.15,.16),
 'PCB_MCU_REFERENCE':(.10,.38,.25),'PCB_BAT_REFERENCE':(.12,.45,.29),
 'PCB_MMU_REFERENCE':(.26,.48,.27),'PCB_SW_REFERENCE':(.12,.40,.30),
 'LCD_91x67p6_REFERENCE':(.32,.40,.38),'GNSS_28x27x8_ALLOCATION':(.88,.77,.49),
 'BATTERY_80x62x7_ALLOCATION':(.36,.54,.76),'WIRELESS_50x50x2_ALLOCATION':(.78,.42,.23),
 'PRINT_MASK_VISUAL':(.025,.04,.045),'AA_VISUAL':(.88,.91,.78),'LCD_FPC_ROUTE':(.83,.49,.10)}

def assembly():
    a=cq.Assembly(name='Trace_Compass_v4_component_layout')
    for n,s in {**manufactured(),**references()}.items():
        a.add(s,name=n,color=cq.Color(*COLORS[n],.2 if n=='protective_lens' else 1))
    a.add(mask(),name='PRINT_MASK_VISUAL',color=cq.Color(*COLORS['PRINT_MASK_VISUAL']))
    a.add(rect(84.8,63.6,.015,31.1,0,10),name='AA_VISUAL',color=cq.Color(*COLORS['AA_VISUAL']))
    a.add(screen_fpc()[0],name='LCD_FPC_ROUTE',color=cq.Color(*COLORS['LCD_FPC_ROUTE']))
    return a

def export():
    OUT.mkdir(exist_ok=True)
    for n,s in manufactured().items():
        for ext in ('step','stl'):cq.exporters.export(s,str(OUT/f'{n}.{ext}'))
    for n,s in references().items():cq.exporters.export(s,str(OUT/f'{n}.step'))
    for n,s in service_spaces().items():cq.exporters.export(s,str(OUT/f'{n}_SPACE.step'))
    cq.exporters.export(mask().faces('<Z').wires(),str(OUT/'lens_print_mask_2D.dxf'))
    assembly().save(str(OUT/'trace_compass_v4_complete_assembly.step'))
    (ROOT/'cable_routes.json').write_text(json.dumps(cable_routes(),indent=2))
    print('Exported v4 parts and component assembly',flush=True)

if __name__=='__main__':export()
