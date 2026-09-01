# Trace Compass v1 enclosure design

## Inputs

- PCB STEP: `3D_PCB6_2026-08-11.step`
- Reused design language from `硬件/外壳`:
  - one-piece shell
  - recessed bonded front panel
  - continuous adhesive seal
  - uninterrupted front panel around the LCD window
  - top-edge silicone button references
  - complete and exploded STEP assemblies

## Measured PCB envelope

The STEP file contains several empty shapes, so the measured envelope ignores void
nodes.

- PCB outline: about `91.0 x 67.0 x 1.6 mm`
- Complete component envelope: about `91.0 x 67.0 x 8.6 mm`
- Left-edge USB connector is kept internal. It is only for firmware flashing
  before final sealing/assembly, so the enclosure has no USB opening.
- Internal clearance reference: microSD card socket and TFT connector

## Current v1 enclosure

- Outer body: `112 x 86 x 18 mm`
- Wall: `2.8 mm`
- Floor: `2.4 mm`
- Bonded front panel: `1.6 mm`
- Front service opening is sized for loading PCB/LCD from the front, then sealed
  by the bonded panel.
- LCD reference follows the existing 4.2 inch landscape display envelope:
  `99.7 x 69.34 x 1.96 mm`.
- USB is not exposed in normal use. There is no side opening or dust cap in the
  enclosure model.
- PCB support is by internal shelf pads and side retaining ribs, avoiding
  assumptions about final screw-hole locations.
- Top-edge buttons are retained as silicone boot references from the previous
  compass enclosure language; the final switch linkage still needs prototype
  validation against the PCB-side button architecture.

## Main generated files

Output directory: `cadquery_out`

- `trace_compass_v1_one_piece_shell.step`
- `trace_compass_v1_bonded_front_panel.step`
- `trace_compass_v1_continuous_panel_adhesive_seal.step`
- `trace_compass_v1_top_edge_silicone_buttons.step`
- `trace_compass_v1_pcb_reference.step`
- `trace_compass_v1_complete_device_assembly.step`
- `trace_compass_v1_internal_fit_assembly.step`
- `trace_compass_v1_panel_bonding_scheme.step`

## Open validation items

- Confirm the final LCD module thickness, FPC bend direction, and connector
  clearance.
- Confirm whether the microSD card needs field access. The current model keeps it
  internal for sealing.
- Confirm final button actuation strategy. The current model preserves the
  top-edge waterproof button concept but does not claim switch-force validation.
- Confirm production flashing workflow before bonding the front panel, since USB
  is intentionally inaccessible after final assembly.
