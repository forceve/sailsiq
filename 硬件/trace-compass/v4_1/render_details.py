"""Engineering views of the actual revised fixture and source-derived pin ordering."""
import json
from PIL import Image,ImageDraw,ImageFont
import trace_compass_v4_1 as m
from render_v4_1 import render
m.ROOT.joinpath('previews').mkdir(exist_ok=True)
base=m.mmu_channel()
board=m.electronics()['PCB_MMU_REFERENCE']
frame=m.mmu_clamp()
items=[('front_housing',base,1),('PCB_MMU_REFERENCE',board,1),('mmu_pressure_frame',frame,1)]
items += [(n,s,1) for n,s in m.mmu_fasteners().items()]
render('05-imu-clamp.png',items,'MMU / RIGID EDGE CLAMP','Integral datum base + removable frame + 4 polymer M2 screws | No foam suspension',pos=(20,65,70),focal=(-59,25,18),scale=19)
exploded=[('front_housing',base,1),('PCB_MMU_REFERENCE',board.translate((9,0,0)),1),('mmu_pressure_frame',frame.translate((18,0,0)),1)]
exploded += [(n,s.translate((25,0,0)),1) for n,s in m.mmu_fasteners().items()]
render('06-imu-exploded.png',exploded,'MMU / EXPLODED','Open center clears chips and FPC | Edge-only bearing | Asymmetric bolt pattern',pos=(40,68,60),focal=(-46,25,18),scale=25)
rows=json.loads((m.ROOT/'fpc_audit.json').read_text())['rows']
im=Image.new('RGB',(1600,1100),'#f6f5f0');d=ImageDraw.Draw(im)
font='C:/Windows/Fonts/msyh.ttc'
f=lambda n:ImageFont.truetype(font,n)
d.text((60,35),'FPC 方向核对：V4 原回折方案不通过',font=f(40),fill='#9b2527')
d.text((60,100),'统一从屏幕正面看：+Y 朝上，FPC 从右短边出线；U 形回折不改变 Y 方向的针脚顺序。',font=f(25),fill='#243b45')
d.text((90,165),'屏幕 FPC（上 → 下）',font=f(28),fill='#243b45')
d.text((850,165),'现有 MCU CN1（上 → 下）',font=f(28),fill='#243b45')
for i,r in enumerate(reversed(rows)):
    y=225+51*i
    col='#35725c' if r['signal_matches'] else '#bd423f'
    d.text((90,y),f"{r['lcd_pin']:2}   {r['lcd_signal']}",font=f(26),fill=col)
    d.line((360,y+20,790,y+20),fill=col,width=3)
    d.polygon([(790,y+20),(777,y+13),(777,y+27)],fill=col)
    d.text((850,y),f"{r['cn1_pin_on_v4_untwisted_route']:2}   {r['cn1_net']}",font=f(26),fill=col)
d.text((60,890),'正确电气映射：屏幕 1 → CN1 12、2 → 11、…、12 → 1。',font=f(29),fill='#243b45')
d.text((60,945),'例如：屏幕 4（VCI）必须接 CN1 9（3V3），原路径却对到 CN1 4（GPIO12）。',font=f(26),fill='#9b2527')
d.text((60,1002),'本图按原始 LCD 图纸针号 + Altium CN1 焊盘坐标计算；连线为对应关系，不是排线形状。',font=f(23),fill='#54656b')
im.save(m.ROOT/'previews/07-fpc-pin-audit.png')
