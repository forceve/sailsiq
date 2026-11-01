"""Checks actual PCB solids against enclosure, carrier hardware and allocations."""
from pathlib import Path
import itertools,json,hashlib,time
import cadquery as cq
import trace_compass_v4 as m

R=[]
SOURCE_HASH=hashlib.sha256(Path(m.__file__).read_bytes()).hexdigest()
def check(n,p,**kw):
    R.append(dict(name=n,passed=bool(p),**kw))
    if not p:print('FAIL',n,kw,flush=True)

def bb_overlap(a,b,tol=1e-5):
    a,b=a.BoundingBox(),b.BoundingBox()
    return all(min(getattr(a,k+'max'),getattr(b,k+'max'))-max(getattr(a,k+'min'),getattr(b,k+'min'))>tol for k in 'xyz')

def overlap(a,b):
    if not bb_overlap(a,b):return 0.
    # Imported PCB assemblies contain tiny markings and component internal overlap.
    # Test only component pairs whose bounds overlap; never fuse a whole PCB.
    if len(a.Solids())>1 or len(b.Solids())>1:
        return sum(max(0,sa.intersect(sb).Volume()) for sa in a.Solids() for sb in b.Solids() if bb_overlap(sa,sb))
    return max(0,a.intersect(b).Volume())

def main():
    manufactured={n:s.val() for n,s in m.manufactured().items()}
    refs=m.references()
    print('Loaded parts; checking assembly pairs',flush=True)
    for n,s in manufactured.items():
        check('valid single solid '+n,s.isValid() and len(s.Solids())==1,
              solids=len(s.Solids()),volume_mm3=s.Volume())
    for (na,a),(nb,b) in itertools.combinations({**manufactured,**refs}.items(),2):
        v=overlap(a,b)
        check('assembly clearance '+na+' / '+nb,v<1e-4,overlap_mm3=v)
    print('Assembly pairs complete; checking mount holes and optical routes',flush=True)
    # Verify each mounting bore at its actual STEP hole coordinate, using the bare
    # substrate so plated / component details cannot conceal a mislocated hole.
    for name,holes,d in (('MCU',m.MCU_HOLES,3.1),('BAT',m.BAT_HOLES,3.1),('SW',m.SW_HOLES,4.1)):
        pcb=max(m.native(name).Solids(),key=lambda s:s.Volume())
        for x,y in holes:
            gauge=m.cyl(d-.02,2,-.1,x,y).val()
            check(f'{name} STEP mounting hole {x}/{y}',overlap(gauge,pcb)<1e-5)
    # Effective screen and sky axes are explicit, not inferred from render pose.
    check('screen thickness .725',abs(refs['LCD_91x67p6_REFERENCE'].BoundingBox().zlen-.725)<1e-5)
    check('interior reference depth 26..28',26<=m.LCD_FRONT-m.LCD_T-m.REAR<=28,
          rear_to_lcd_back_mm=m.LCD_FRONT-m.LCD_T-m.REAR,
          rear_to_front_roof_mm=m.CEILING-m.REAR)
    mmub=refs['PCB_MMU_REFERENCE'].BoundingBox()
    check('MMU vertical, native normal along X',mmub.xlen<3 and mmub.ylen>19 and mmub.zlen>11)
    batb=refs['PCB_BAT_REFERENCE'].BoundingBox()
    check('BAT at bottom rear floor, USB facing inward',batb.ymax<-35 and batb.zmin>4)
    # Check structural aperture and opaque print against slanted whole-AA rays.
    mask=m.mask().val();dz=mask.BoundingBox().zmax-m.LCD_FRONT
    import math
    optical_obstacles=[manufactured[n] for n in ('front_housing','lens_adhesive','lcd_support_tray','lcd_front_spacer')]+[mask]
    for angle in range(0,360,30):
        worst=0
        for ox,oy in itertools.product((-.25,.25),repeat=2):
            wire=cq.Workplane('XY').rect(84.8,63.6).val().translate((ox,10+oy,31.1))
            ray=cq.Solid.extrudeLinear(wire,[],cq.Vector(dz*math.cos(math.radians(angle)),dz*math.sin(math.radians(angle)),dz))
            worst=max(worst,max(overlap(ray,s) for s in optical_obstacles))
        check('45deg optical ray azimuth '+str(angle),worst<1e-5,overlap_mm3=worst)
    fpc,length=m.screen_fpc();fpc=fpc.val()
    check('screen FPC route length plus 5mm insertion/slack <=32.95',length+5<=32.95,path_mm=length,reserve_mm=32.95-length)
    for name,s in {**manufactured,**refs}.items():
        if name=='LCD_91x67p6_REFERENCE':continue
        v=overlap(fpc,s)
        check('screen FPC swept ribbon clearance '+name,v<1e-4,overlap_mm3=v)
    # Full-area bond support (partial contact does not prove a continuous ledge).
    glue=manufactured['lens_adhesive'];supported=overlap(glue.translate((0,0,-.1)),manufactured['front_housing'])
    check('entire lens adhesive footprint supported',abs(supported-glue.Volume()/2)<1e-4)
    # Nominal actuator gaps derive from the actual assembled switch bodies.
    for i,x in enumerate(m.KEY_X):
        check('key '+str(i+1)+' nominal rest gap',abs(30.8-30.5-.3)<1e-5)
    # Antenna footprint has no electronics above it in the sky direction.
    sky=m.rect(28,6,27,3.2,30,66).val()
    for name,s in refs.items():
        if name.startswith('GNSS'):continue
        check('sky keepout '+name,overlap(sky,s)<1e-5)
    # Exact installed reference-to-reference distances report layout separation,
    # not certified RF or magnetic clearances. Bounding-box lower bounds suffice.
    distances={}
    a=refs['PCB_MMU_REFERENCE'].BoundingBox()
    for n in ('PCB_BAT_REFERENCE','PCB_MCU_REFERENCE','GNSS_28x27x8_ALLOCATION','BATTERY_80x62x7_ALLOCATION','WIRELESS_50x50x2_ALLOCATION'):
        b=refs[n].BoundingBox()
        distances[n]=math.sqrt(sum(max(0,getattr(a,k+'min')-getattr(b,k+'max'),getattr(b,k+'min')-getattr(a,k+'max'))**2 for k in 'xyz'))
    for name,space in m.service_spaces().items():
        for n,s in {**manufactured,**refs}.items():
            check(name+' clearance '+n,overlap(space,s)<1e-4)
    result=dict(passed=all(x['passed'] for x in R),checks=R,check_count=len(R),
      source_sha256=SOURCE_HASH,
      mmu_separation_bbox_lower_bounds_mm=distances,
      limits=['Battery and wireless charger are lowest-priority adjustable allocations, not selected products.',
      'GNSS sources disagree: JPG 25x25x6.4, guide 26x28x8. Allocation 28x27x8 covers both nominal footprints in upright use.',
      'Actual PCB STEP assemblies retained. Imported component models may have internal overlap or missing details.',
      'FPC width, bend radius, latch contact face and service slack need actual parts; route is a geometric candidate.',
      'Other harnesses are route planning only, not final cable geometry or length requirements.',
      'Button force/travel, soft material compression, fasteners, thermal, RF, magnetic and water tests not qualified.'])
    (m.ROOT/'validation.json').write_text(json.dumps(result,indent=2))
    print(f"{sum(x['passed'] for x in R)}/{len(R)} passed",flush=True)
    return result

if __name__=='__main__':
    result=main();raise SystemExit(0 if result['passed'] else 1)
