# 桅杆截面与 Bracing 模型

Masts 集中管理桅杆公共几何、规格证据、原厂参考资料、验证脚本和 FreeCAD 宏。三款支架的入口和装配输出仍在各自硬件目录。

当前支架为 **V7 全周滚动过渡**：沿鞍座与共同主干的实际闭合交线生成过渡，取消会产生内部尖槽的 V6 径向环形接管；保留连续分叉和面板端展宽。完整尺寸、Cunningham 两侧候选通道、制造与验证方案见 [TREE_BRACING_DESIGN.md](TREE_BRACING_DESIGN.md)。

先阅读 [规格核对与未确认项](SPECS.md)。[specs.json](specs.json) 区分目录字段和估算字段，验证器会检查三个入口的默认参数与它一致。

- 23R：候选 C126，79 × 126 mm，目录壁厚 2.4 mm。
- 28R：候选 C139，85 × 139 mm，目录壁厚 2.5 mm。
- J80：IMS-80 版本，82 × 133 mm，模型壁厚 2.5 mm 为估算。

两款 Fareast 的具体型材仍需 Mast ID 确认。Seldén 方槽与 IMS-80 圆槽分别建模，旧的共用圆槽图不再驱动几何。700 mm 均为局部参考段。

## 文件分工

| 文件 | 用途 |
|---|---|
| mast_section.py | 两类光滑轮廓、法向偏移、槽壁及外形查询 |
| tree_bracing.py | 共用树状支架参数、面板端与整体装配 |
| branch_junction.py / root_blend_v7.py | 偶四次分叉曲面、实际闭合交线上的全周过渡 |
| validate_root_blend_v7.py / junction_quality.py | 最终实体闭合接触、接缝法向和内部曲率；独立剖面检查 |
| shape_metrics.py | 复杂样条实体的统一自适应体积积分 |
| normalize_cad_edges.py | 在现有节点处精确分边，并根据实测相邻表示误差修正边/端点容差；导出后仍要求完整原生 BOP |
| specs.json / SPECS.md | 规格、证据、估算值与船型对应状态 |
| references/ | 原厂目录、截面图、下载清单和矢量路径 |
| validate_mast_sections.py | 几何、支架间隙、目录量级和 STEP 回读检查 |
| mast_section_review.FCMacro | FreeCAD 有效性与 BOP 检查、原生文件和视图 |
| cadquery_out/ | 生成的对照与审阅结果，不纳入版本控制 |

## 重新生成

在仓库根目录，使用安装 CadQuery、ezdxf、matplotlib、Pillow 的 Python：

~~~powershell
python 硬件/Fareast23RBracingMount/fareast23r_bracing_mount.py
python 硬件/Fareast28RBracingMount/fareast28r_bracing_mount.py
python 硬件/J80BracingMount/j80_mast_bracing_mount.py
python Masts/validate_mast_sections.py
python Masts/validate_tree_bracing.py
~~~

随后在 FreeCAD 运行本目录 mast_section_review.FCMacro；宏只管理它创建的文档。

每款硬件目录的 cadquery_out 包含：

- *_mast_700mm_from_section.step：700 mm 局部参考段。
- *_mast_section_20mm.step、*_mast_section.dxf、*_mast_section.svg：短段和二维截面。
- *_mast_refined.FCStd：完整参考段与短段两个对象，默认显示短段；改看完整段时应隐藏短段。
- *_mast_700mm_semi_bracing_mount_assembly.step：同步更新的支架装配。
- section_validation.json：目录偏差、几何及间隙检查结果。

本目录 cadquery_out 包含 mast_sections_refined.FCStd、freecad_sections_top.png、freecad_sections_3d.png、mast_sections_comparison.png 和 freecad_validation.json。FCStd 是导入实体审阅文件；修改参数需编辑 Python 并重新生成。

## 核对范围

C 系列用 13 个未参与样条拟合的目录测点检查，最大偏差约 0.25/0.28 mm，表示归一化示意图的拟合误差，不是实际型材公差。IMS-80 直接采用目录外轮廓 Bézier，不用同一曲线反算独立拟合精度。

检查包括单一有效实体、开放槽口、封闭主腔、保留槽壁、对称性、法向壁厚、支架/硅胶/绑带实体数和干涉、STEP 回读及 FreeCAD BOP。质量和惯性矩剩余偏差见 SPECS.md。模型用于形状和装配参考。

## 三款 Bracing Mount · 3 mm 硅胶垫

三款支架按各自的新桅杆轮廓生成，硅胶垫未压缩厚度统一为 **3 mm**，沿接触轮廓法向计量。支架贴合面、连接板、面板和绑带位置随厚度参数同步更新。此值是用户设计要求，记录在 specs.json 的 mount_design，不属于厂商桅杆规格。

运行上面的三个装配生成器与验证器后，在 FreeCAD 运行 **bracing_mount_review.FCMacro**。新增输出：

- 每款 cadquery_out 下的 *_front_silicone_padding.step：独立硅胶垫。
- *_bracing_mount_refined.FCStd：桅杆安装区域、支架、硅胶垫和两条绑带的彩色审阅装配。
- *_bracing_mount_top.png / *_bracing_mount_3d.png：俯视图及轴测图。
- Masts/cadquery_out/bracing_mounts_3mm.FCStd：三款并排对照。
- bracing_mounts_top.png / bracing_mounts_3d.png，以及 tree_freecad_validation.json。

审阅文件将桅杆显示为安装位置附近的 180 mm 段，便于观察支架；每款文档另保留隐藏的完整 700 mm 参考段。包含设备、盖板和螺钉的完整装配仍使用 *_mast_700mm_semi_bracing_mount_assembly.step。

几何检查同时测量桅杆到支架的实际最小间距、硅胶两侧接触，以及桅杆/支架/硅胶/绑带的干涉。绑带按装配形状示意，未模拟硅胶受压或绑带预紧变形。

FreeCAD 导入说明：当前支架节点使用同源 BREP 构建原生文件，保留小于 0.01 mm 的局部求交表示容差，并完整执行 BOP 和重开验证。STEP 单独回读几何与体积；其默认导入可能有曲线/曲面一致性告警。报告记录来源及容差，不忽略原生自交。详见 [当前验证说明](TREE_BRACING_DESIGN.md)。

## 当前树状支架交付

当前为 **tree-v7**：沿主干与鞍座实际闭合交线生成全周滚动过渡，取消会产生内部尖槽的 V6 径向环形接管。23R 滚动半径 4 mm，28R/J80 为 5 mm；滚动半径不代表所有方向的主曲率半径。保留同一偶四次分叉曲面和 V4 面板端连续展宽，内侧定位条缩至 Y=5–12 mm。

运行 `python Masts/build_tree_v7.py` 分阶段生成、验证并发布三款。随后运行 `tree_bracing_review.FCMacro`、`verify_tree_native.py`、`package_tree_bracing.py`。根部检查同时覆盖闭合接触、实际接缝有向法向和曲面内部主曲率；完整装配及原生检查仍需通过。

主文件为各船型 `*_tree_bracing_mount.FCStd / .step / .stl / .brep`。派生 connector 仅作显示参考，不是单独制造件。新通道和橙色绳均为未实测候选位置。V6 已保存在 `cadquery_out/tree_v6`。参数和验证范围见 [当前设计](TREE_BRACING_DESIGN.md)，本次没有新有限元或数值拓扑优化，尚不构成承载验证。
