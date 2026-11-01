"""Source-based pin-order audit; expected failure is recorded, never counted as clearance."""
from pathlib import Path
import json,hashlib
ROOT=Path(__file__).parent
pcb=ROOT/'inspection/MCU.pcbdoc'
rs=[dict(t.split('=',1) for t in l.split('|') if '=' in t) for l in pcb.read_text(encoding='utf-8',errors='replace').splitlines()]
mm=lambda s:float(s.replace('mil',''))*.0254
outline=next(r for r in rs if 'VX0' in r)
y0=min(mm(v) for k,v in outline.items() if k.startswith('VY'))
cn=next(r for r in rs if r.get('SOURCEDESIGNATOR')=='CN1')
nets={r['ID']:r['NAME'] for r in rs if r.get('RECORD')=='Net'}
pads={int(r['NAME']):r for r in rs if r.get('RECORD')=='Pad' and r.get('COMPONENT')==cn['ID'] and r['NAME'].isdigit() and int(r['NAME'])<=12}
lcd=['GND','NC','NC','VCI','GND','TE','DC','CS','SCL','SDA','RESET','GND']
signals={'GND':'GND','NC':'NC','3V3':'VCI','GPIO_10':'RESET','GPIO_11':'SDA','GPIO_12':'SCL','GPIO_13':'CS','GPIO_14':'DC','GPIO_21':'TE'}
rows=[]
for pin,name in enumerate(lcd,1):
    # Manufacturer front view: pin 1 is left when tail points down.
    # Rotate front view CCW 90deg to place the tail on device right: pin 1 is -Y.
    y_lcd=10+(pin-6.5)*.5
    actual=min(pads,key=lambda n:abs(mm(pads[n]['Y'])-y0-24.5-y_lcd))
    net=nets.get(pads[actual].get('NET'),'NC')
    expected=13-pin
    rows.append(dict(lcd_pin=pin,lcd_signal=name,lcd_device_y_mm=round(y_lcd,4),
       cn1_pin_on_v4_untwisted_route=actual,cn1_device_y_mm=round(mm(pads[actual]['Y'])-y0-24.5,4),
       cn1_net=net,signal_matches=signals[net]==name,required_cn1_pin=expected,
       required_net_matches=signals[nets.get(pads[expected].get('NET'),'NC')]==name))
assert all(r['cn1_pin_on_v4_untwisted_route']==r['lcd_pin'] for r in rows)
assert all(r['required_net_matches'] for r in rows)
result=dict(status='BLOCKED',v4_direct_route_electrically_valid=all(r['signal_matches'] for r in rows),
  reference_view='From display front: +X right, +Y sky, +Z viewer; FPC exits right short edge.',
  pcb_sha256=hashlib.sha256(pcb.read_bytes()).hexdigest(),rows=rows,
  drawing_dimensions_mm={'tail_length':32.95,'tail_length_tolerance':.3,'pitch':.5,'contact_width':.3,'contact_span':5.5,'tail_width':6.5,'tail_width_tolerance':.1,'exposed_contact_length':3.5,'reinforcement_length':5,'reinforced_thickness':.3,'reinforced_thickness_tolerance':.03},
  mechanical_findings=['v4 tail strip bottom Z=20.725 exceeds supplied connector maximum Z=20.6201: route did not mate.',
  'v4 R2 bends were not constrained to the manufacturer single-layer bend region; 1.0 mm component region was not modeled.',
  'v4 0.15 mm uniform strip omitted 0.30 mm reinforced contact tail.',
  'Turning MCU about device X flips its Y pin order without changing +X insertion side; viable direction to investigate, not an approved assembly.'])
(ROOT/'fpc_audit.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print('FPC audit: same-number physical mapping; only',sum(r['signal_matches'] for r in rows),'of 12 signals match. Required reverse order validated.')
