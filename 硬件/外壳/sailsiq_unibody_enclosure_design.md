# SailSIQ 智能罗经一体式外壳方案

## 当前设计输入

- 使用场景：帆船竞赛/训练用智能罗经，本体类似加厚横屏手机，固定在桅杆上；本方案只包含设备本体。
- 外壳材料：染色玻纤方向，不做额外 RF/GNSS 窗口标识。
- 屏幕：4.2" MONO TFT，屏幕参考图尺寸为 PCB `69.34 x 99.7 mm`，LCD AA `63.6 x 84.8 mm`；横装后参考包络为 `99.7 x 69.34 mm`。
- 已纳入真实板件重建：MCU 主板、供电板、IMU 板、按钮板、LCD 模组参考。
- 仍缺：GPS 主板和天线，当前没有放入总装。

## 重新设计结论

- 外形尺寸从上一版 `164 x 106 x 22 mm` 收窄为 `140 x 106 x 22 mm`，屏幕可视区左右边框约 `26 mm`，上下边框约 `20 mm`，外观比例更接近均匀。
- 复材壳体按外模制造思路处理：外表面保持受控，内部掏空为薄壁结构，侧壁和底壁统一按 `3.0 mm` 建模。
- 正面面板外表面与壳体正面齐平，不做高出一圈的外唇；粘接区保留 `6.0 mm` 胶接台阶宽度。
- 台阶以下的内部体积向外壳边缘掏空，内腔参考包络为 `134 x 100 mm`，顶部到 `z=17.40 mm`。
- 底部内腔和服务开口都从 `z=3.0 mm` 开始切除，底壁保持统一 `3.0 mm`，不再保留局部切薄台阶；内腔切除体不做上下边倒圆。
- 正面树脂面板保持完整，不再开按钮孔，以保证一体树脂面板粘接可靠度。
- 四个按钮在顶部边缘，孔位按按钮板 STEP 重建的 `SW1-SW4` 实际中心调整：相对按钮板中心为 `-25.127 / -10.127 / 9.873 / 24.873 mm`，间距为 `15 / 20 / 15 mm`。
- 硅胶外套按 `8 mm` 总高方案建模：3 mm 柱、7 mm 内侧密封底座/裙边，裙边自由高度按 `1.3 mm` 并计入总高；壳体按钮孔为 `4 mm`，匹配 3 mm 柱和 3.5 mm 圆形微动触点。开关顶面到壳体内壁的名义间隙为 `1.0 mm`，裙边自由高度多出的 `0.3 mm` 作为螺丝压紧后的密封预压。
- 硅胶底座不放在壳体外侧，而是放在柱子内侧根部：自由状态为 `y=49.0..50.3 mm`，装配后由按钮板开关面压到壳体内壁 `y=50.0 mm`，用于从内向外压紧密封。
- 按钮板按真实 `60 x 10 mm` 板体旋转到顶部边缘，作为结构/干涉参考；使用按钮板现有两个 `2.2 mm` 孔作为 M2 螺丝孔，对应壳体全局位置约 `x=-17.627 / 17.373 mm, z=11.5 mm`。
- 壳体内侧新增两个热铆螺母基座：基座外径 `6.2 mm`，从按钮板外侧面 `y=44.1 mm` 延伸到顶部内壁 `y=50.0 mm`；热铆螺母盲孔按 `Ø3.45 x 3.8 mm` 建模，不打穿外壳外表面。螺丝从设备内部穿过按钮板，将按钮板/开关压向硅胶按键和壳体内壁。
- LCD 使用真实尺寸横装，外观可视窗按 `88 x 66 mm`，显示 AA 参考按 `84.8 x 63.6 mm`。

## 内部布局

- LCD：靠近正面面板下方，包络 `99.7 x 69.34 x 1.96 mm`。
- MCU 主板：中上偏右，包络 `64 x 40 x 6.699 mm`。
- 电池：下方居中，参考包络 `76 x 40 x 7 mm`。
- 供电板：中上偏左，包络 `30 x 30 x 8.1 mm`。
- IMU 板：右侧中下区域，包络 `30 x 10 x 5.45 mm`；保留 `R20` 磁敏感禁布/禁金属参考区。
- 按钮板：顶部边缘竖放，PCB 板体包络 `60 x 1.6 x 10 mm`；按钮板真实开关包络与壳体配合形成 `1.0 mm` 名义密封间隙，M2 螺丝锁到热铆螺母基座后压缩 `1.3 mm` 硅胶裙边。

## CadQuery 文件

- `sailsiq_compass_enclosure.py`：一体壳、面板、胶线、顶部按钮、完整装配。
- `sailsiq_boards_reconstructed.py`：由 STEP 反推的 MCU/供电/IMU/按钮板和 LCD 参考件。
- `pcb2_reconstructed_from_step.py`：早期单板反推实验，可作为参考。

## 厚度与位置控制

整机厚度和内部件位置都集中在 `sailsiq_compass_enclosure.py` 的 `Params`：

- `body_t`：整机厚度。
- `wall/floor`：复材壳体侧壁和底壁厚度，当前统一为 `3.0 mm`。
- `bond_ledge`：正面面板粘接台阶宽度，当前为 `6.0 mm`。
- `lcd_gap_under_panel`：LCD 顶面到树脂面板下方的间隙。
- `mcu_x/mcu_y/mcu_z`：MCU 主板位置。
- `power_x/power_y/power_z`：供电板位置。
- `imu_x/imu_y/imu_z`：IMU 板位置。
- `battery_x/battery_y/battery_z`：电池位置。
- `button_offsets_x/top_button_board_y/top_button_board_z`：顶部按钮孔位和按钮板位置。
- `button_boot_h/button_skirt_h/button_base_d/button_post_d`：硅胶外套总高、裙边自由高度、底座宽度和柱子宽度。
- `button_mount_* / button_heat_set_* / button_screw_*`：按钮板固定孔筛选、热铆螺母基座/盲孔和 M2 螺丝参考尺寸。

因此后续要压薄或加厚，不需要重画模型，先调这些参数再重新导出 STEP。

## 主要导出

输出目录：

```text
硬件/外壳/cadquery_out
```

关键 STEP：

- `sailsiq_one_piece_shell.step`：一体式壳体。
- `sailsiq_bonded_front_panel.step`：完整无按钮孔的粘接树脂面板。
- `sailsiq_continuous_panel_adhesive_seal.step`：连续胶线/泡棉胶位置。
- `sailsiq_direct_protruding_buttons.step`：顶部伸出按钮参考。
- `sailsiq_silicone_button_boots.step`：按 8 mm 柱高建模的硅胶外套按钮参考。
- `sailsiq_button_board_reference.step`：顶部按钮板参考，包含重建的开关/连接器包络用于干涉检查。
- `sailsiq_button_board_mount_hardware.step`：按钮板 M2 螺丝和热铆螺母参考件。
- `sailsiq_complete_device_assembly.step`：完整设备总装。
- `sailsiq_internal_fit_assembly.step`：透明壳体内部干涉检查总装。
- `sailsiq_boards_reconstructed_assembly.step`：所有重建板件集合。

## 后续需要锁定

- GPS 主板和天线 STEP，特别是天线净空和朝向。
- 顶部按钮最终防水结构：热铆螺母规格、M2 螺丝长度/扭矩、硅胶硬度与 `0.3 mm` 预压量需要打样验证。
- 电池真实型号、厚度、线束出口和固定方式。
- 各板之间的线束/FPC 走向和最小弯折半径。
- 面板材料、遮蔽丝印、胶种和胶宽验证。
