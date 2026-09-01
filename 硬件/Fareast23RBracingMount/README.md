# Fareast23R Bracing Mount Reference

This folder follows the J80 mast bracing mount CadQuery layout.

- Mast reference: C126 section from the 2006 C-section chart
- Modeled size: 79 mm side width, 126 mm fore/aft depth
- The mast outline is a traced C-section reference: rounded bottom, fuller mid-body sides, pinched rail-side shoulders, and a luff-groove head.
- Wall and luff groove details are proportional references because the chart only provides the outer section size.

Run:

```powershell
python fareast23r_bracing_mount.py
```

Outputs are written to `cadquery_out/`.

Additional compatibility output:

- `fareast23r_c126_mast_with_j80_bracing_reference_assembly.step` shows the original J80 bracing assembly installed on the C126 mast reference. The translucent orange body is the original J80 mast reference for comparison.
