"""Two catalogue-derived mast families. See SPECS.md for evidence limits.

X is beam, +Y is the luff groove, Z is the reference segment length. The
closed envelope bridges the groove for padding/strap offsets only. The mast
itself has an open throat and a separate, enclosed main cavity.
"""
from __future__ import annotations

from functools import lru_cache
import json
from pathlib import Path
from math import sqrt

import cadquery as cq
from OCP.ShapeUpgrade import ShapeUpgrade_ShapeDivideContinuity
from OCP.GeomAbs import GeomAbs_C1

TRACES = json.loads((Path(__file__).parent / "references/profile_traces.json").read_text(encoding="utf-8"))


class MastSection:
    def __init__(self, family: str):
        self.family = family
        self.trace = TRACES[family]

    def source_point(self, point, width, depth):
        d = self.trace
        return cq.Vector((point[0] - d["center_x"]) / (2 * d["half_width"]) * width,
                         ((point[1] - d["nose_y"]) / (d["top_y"] - d["nose_y"]) - 0.5) * depth, 0)

    @lru_cache(maxsize=128)
    def envelope_wire(self, width: float, depth: float, offset: float = 0.0) -> cq.Wire:
        if width <= 0 or depth <= 0:
            raise ValueError("Positive section dimensions required")
        convert = lambda xy: self.source_point(xy, width, depth)
        if self.family == "ims80":
            right = []
            for segment in self.trace["outer_beziers"]:
                pts = [convert(xy) for xy in segment]
                right.append(cq.Edge.makeBezier(pts) if len(pts) == 4 else cq.Edge.makeLine(*pts))
            top = right[-1].endPoint()
        else:
            # Sparse stations remove drafting noise. Remaining stations are
            # reserved for checking the fit, not used as spline control points.
            raw = self.trace["outer_right"]
            nearest = lambda y: min(raw, key=lambda xy: abs(xy[1] - y))
            first = [convert(nearest(y)) for y in
                     (477.0059, 478.2589, 484.3279, 489.6589, 498.3569, 509.0209, 518.7999, 529.0939)]
            second = [convert(nearest(y)) for y in
                      (529.0939, 536.4409, 545.4329, 553.3449, 559.8309, 564.3029, 566.4649, 567.7179)]
            top = convert(raw[-1])
            lead = top - second[-1]
            right = [
                cq.Edge.makeSpline(first, tangents=(cq.Vector(1, 0, 0), cq.Vector(0, 1, 0))),
                cq.Edge.makeSpline(second, tangents=(cq.Vector(0, 1, 0), lead.normalized())),
                cq.Edge.makeLine(second[-1], top),
            ]
        edges = right + [edge.mirror("YZ") for edge in reversed(right)]
        edges.append(cq.Edge.makeLine(top, cq.Vector(-top.x, top.y, 0)))
        wire = cq.Wire.assembleEdges(edges)
        if offset:
            wires = wire.offset2D(offset, "arc")
            if len(wires) != 1:
                raise ValueError("Section offset split into multiple wires")
            # Resolve OCC offset curves before STEP export: direct offset
            # surfaces can import as disconnected shells in FreeCAD.
            wire = wires[0].toSplines(degree=8, tolerance=1e-6)
            # Split at C0 knot boundaries introduced by OCC approximation;
            # each exported curve must be at least C1 for FreeCAD's BOP check.
            divider = ShapeUpgrade_ShapeDivideContinuity(wire.wrapped)
            divider.SetBoundaryCriterion(GeomAbs_C1)
            divider.Perform()
            wire = cq.Shape.cast(divider.Result())
        return wire

    def envelope_solid(self, width, depth, length, offset=0.0):
        return cq.Workplane("XY").add(cq.Solid.extrudeLinear(
            self.envelope_wire(width, depth, offset), [], (0, 0, length)))

    def envelope_points(self, width, depth, samples=32):
        points, _ = self.envelope_wire(width, depth).sample(samples * 6)
        return [(p.x, p.y) for p in points]

    @lru_cache(maxsize=512)
    def right_x_at_y(self, width, depth, y, offset=0.0):
        face = cq.Face.makeFromWires(self.envelope_wire(width, depth, offset))
        line = cq.Edge.makeLine((-width - abs(offset) - 1, y, 0), (width + abs(offset) + 1, y, 0))
        cut = face.intersect(line)
        if not cut.Edges():
            raise ValueError(f"Y station {y} outside section")
        return cut.BoundingBox().xmax

    def hollow_mast(self, width, depth, length, wall, chamber_width, chamber_depth, mouth_width):
        """Retained box track (Selden) or stepped, rounded track (IMS-80).

        Unlabelled track details are editable drawing estimates, not tooling
        dimensions. Main wall is a normal offset, never a rescaled outline.
        """
        if not (length > 0 and wall > 0 and mouth_width > 0 and
                mouth_width + 2 * wall < chamber_width < width - 2 * wall and
                2 * wall < chamber_depth < depth / 2):
            raise ValueError("Incompatible mast / groove dimensions")
        top, half = depth / 2, chamber_width / 2
        floor = top - chamber_depth
        shell = cq.Workplane("XY").add(cq.Solid.extrudeLinear(
            self.envelope_wire(width, depth), [self.envelope_wire(width, depth, -wall)], (0, 0, length)))
        lip_r = wall / 2
        lip_x = mouth_width / 2 + lip_r
        pocket = (cq.Workplane("XY").moveTo(-lip_x, top + 1).lineTo(lip_x, top + 1)
                  .lineTo(lip_x, top)
                  .threePointArc((mouth_width / 2, top - lip_r), (lip_x, top - wall))
                  .lineTo(half, top - wall))
        if self.family == "selden_c":
            corner = min(wall * 0.6, 1.5)
            pocket = (pocket.lineTo(half, floor + corner)
                      .threePointArc((half - corner + corner / sqrt(2), floor + corner - corner / sqrt(2)), (half - corner, floor))
                      .lineTo(-half + corner, floor)
                      .threePointArc((-half + corner - corner / sqrt(2), floor + corner - corner / sqrt(2)), (-half, floor + corner))
                      .lineTo(-half, top - wall))
            web = (cq.Workplane("XY").center(0, (top + floor - wall) / 2)
                   .rect(chamber_width + 2 * wall, chamber_depth + wall).extrude(length))
            # Flat inward flange visible in the generic C-series illustration.
            flange_t = wall * 0.55
            flange = (cq.Workplane("XY").center(0, floor - wall + flange_t / 2)
                      .rect(chamber_width + 4 * wall, flange_t).extrude(length))
            web = web.union(flange)
        else:
            # Circular bowl and horizontal lands from the S80 catalogue.
            radius = chamber_width * (1.41 / 5.852)
            cy = floor + radius
            pocket = (pocket.lineTo(half, cy)
                      .lineTo(radius, cy).threePointArc((0, floor), (-radius, cy))
                      .lineTo(-half, cy).lineTo(-half, top - wall))
            web = (cq.Workplane("XY").center(0, (top + cy - wall) / 2)
                   .rect(chamber_width + 2 * wall, top - cy + wall).extrude(length))
            web = web.union(cq.Workplane("XY").center(0, cy).circle(radius + wall).extrude(length))
            # Small inward T-rib in the supplied IMS-80 image. Its dimensions
            # are estimates, absent from the public spec table.
            stem = cq.Workplane("XY").center(0, floor - wall - 0.7).rect(1.4, 1.6).extrude(length)
            cap = cq.Workplane("XY").center(0, floor - wall - 1.5).rect(4.5, 1.0).extrude(length)
            web = web.union(stem).union(cap)
        pocket = (pocket.lineTo(-lip_x, top - wall)
                  .threePointArc((-mouth_width / 2, top - lip_r), (-lip_x, top))
                  .close().extrude(length + 2).translate((0, 0, -1)))
        mast = shell.union(web.intersect(self.envelope_solid(width, depth, length))).cut(pocket).clean()
        if not mast.val().isValid() or len(mast.solids().vals()) != 1:
            raise ValueError("Mast must be one valid connected solid")
        return mast


SELDEN_C = MastSection("selden_c")
IMS80 = MastSection("ims80")
# Fareast generators default to Selden; J80 explicitly binds IMS80.
envelope_wire = SELDEN_C.envelope_wire
envelope_solid = SELDEN_C.envelope_solid
envelope_points = SELDEN_C.envelope_points
right_x_at_y = SELDEN_C.right_x_at_y
hollow_mast = SELDEN_C.hollow_mast
