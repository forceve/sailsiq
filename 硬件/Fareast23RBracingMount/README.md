# Fareast 23R Bracing Mount Reference

Current candidate section: Seldén C126, 79 × 126 mm, catalogue wall 2.4 mm and 5 mm luff-groove mouth. The supplier is confirmed, but the exact boat-to-section assignment still requires the physical Mast ID.

The body follows the manufacturer's generic C-series illustration, with a rectangular track and inward flange. Undimensioned track details remain estimates. The old shared round-groove image is retained as history and no longer drives the geometry.

See [specifications and evidence](../../Masts/SPECS.md) and [generation / FreeCAD workflow](../../Masts/README.md). The 700 mm mast is a local reference segment.

From this folder, run:

~~~powershell
python fareast23r_bracing_mount.py
~~~

Outputs are written to cadquery_out. From the repository root, run python Masts/validate_mast_sections.py for all three models, then run Masts/mast_section_review.FCMacro in FreeCAD.

The additional fareast23r_c126_mast_with_j80_bracing_reference_assembly.step compares the updated IMS-80 J80 bracket with this candidate mast. The orange body is the current IMS-80 reference. This comparison file does not certify interchangeability.

The matching saddle now uses **3 mm uncompressed silicone padding**, measured normal to the mast envelope. The pad is exported separately as *_front_silicone_padding.step. Run Masts/bracing_mount_review.FCMacro after generation and validation for the updated native FreeCAD mount and three-model comparison.

## Tree-bracing V7 revision

The root now uses a whole-perimeter rolling blend on the actual closed saddle/fork intersection. V6's radial annulus could remain tangent at its boundary while forming an interior knife-like groove; it has been retired. The shared quartic fork and widening V4 panel terminals remain.

Root rolling radii are 4 mm for FAREAST23R and 5 mm for FAREAST28R/J80. Fareast central-section parameters were adjusted to avoid local fillet folds. These radii do not bound both principal curvatures. Inner strap locators end at Y=12 mm to avoid crossing the root; outer locators remain unchanged. Silicone remains 3 mm, and saddle/pad/panel heights remain 128 mm.

See [current design](../../Masts/TREE_BRACING_DESIGN.md) and [validation](../../Masts/cadquery_out/tree_bracing_validation.json). Full-solid checks cover closed contacts, adjacent normals, interior curvature, assembly clearances, STEP/STL and native BOP. Geometry acceptance is not strength qualification; no new V7 FEA was run. Rope envelopes remain unmeasured.

Run Masts/build_tree_v7.py, then tree_bracing_review.FCMacro and verify_tree_native.py. Main deliverables remain *_tree_bracing_mount.FCStd / .step / .stl / .brep. The connector is a display-only reference trimmed at the panel back and 0.02 mm outside the nominal saddle. Print the complete mount. Prior V6 files are archived under Masts/cadquery_out/tree_v6.

