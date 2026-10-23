"""Compact, circumferentially tangent root surface on the exact saddle curve.

The displacement is along X, not a normal-thickness specification. Its value
and gradient vanish on the whole rectangular footprint, so tangent planes
match the curved shell in every direction, including diagonal approaches.
"""
from math import comb
from functools import lru_cache
import numpy as np
from numpy.polynomial import Polynomial
import cadquery as cq
from OCP.BRep import BRep_Tool
from OCP.Geom import Geom_BezierSurface
from OCP.TColgp import TColgp_Array2OfPnt
from OCP.gp import gp_Pnt
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace, BRepBuilderAPI_MakeEdge
from OCP.BRepLib import BRepLib


def _power(poles):
    n = len(poles)-1
    t = Polynomial([0, 1]); s = Polynomial([1, -1])
    result = Polynomial([0])
    for k, value in enumerate(poles):
        result += value*comb(n,k)*(t**k)*(s**(n-k))
    return result


def _bernstein(poly, degree):
    return [sum(poly.coef[j]*comb(k,j)/comb(degree,j)
                for j in range(min(k,len(poly.coef)-1)+1)) for k in range(degree+1)]


def _parameter_y(curve, y):
    lo, hi = curve.FirstParameter(), curve.LastParameter()
    for _ in range(55):
        mid = (lo+hi)/2
        if curve.Value(mid).Y() < y: lo = mid
        else: hi = mid
    return (lo+hi)/2


def height(y, z, y0, y1, hz, peak):
    """Exact intended height; z is relative to mount centre."""
    if not y0 < y < y1 or abs(z) >= hz:
        return 0.0
    mid = (y0+y1)/2
    t = (y-y0)/(mid-y0) if y <= mid else (y1-y)/(y1-mid)
    return peak*(3*t*t-2*t*t*t)*(1-(z/hz)**2)**3


@lru_cache(maxsize=24)
def root_patch(p, section, y0=0.0, y1=44.0, hz=15.0, peak=7.5):
    wire = section.envelope_wire(p.mast_outer_w,p.mast_outer_h,
                                 p.silicone_gap+p.front_bracing_side_t)
    mid = (y0+y1)/2
    segments = []
    for edge in wire.Edges():
        box = edge.BoundingBox()
        if box.xmin < 20 or box.ymax <= y0 or box.ymin >= y1:
            continue
        curve = BRep_Tool.Curve_s(edge.wrapped,0.,0.).Copy()
        assert curve.NbKnots() == 2 and not curve.IsRational()
        if curve.Value(curve.FirstParameter()).Y() > curve.Value(curve.LastParameter()).Y():
            curve.Reverse()
        a = max(y0,curve.Value(curve.FirstParameter()).Y())
        b = min(y1,curve.Value(curve.LastParameter()).Y())
        cuts = [a]+([mid] if a < mid < b else [])+[b]
        for ya,yb in zip(cuts,cuts[1:]):
            c = curve.Copy()
            c.Segment(_parameter_y(c,ya),_parameter_y(c,yb))
            segments.append((ya,yb,c))
    segments.sort(key=lambda r:r[0])
    assert abs(segments[0][0]-y0) < 1e-7 and abs(segments[-1][1]-y1) < 1e-7
    faces=[]; baseline=[]
    for ya,yb,c in segments:
        base = c.Copy()
        baseline.append(cq.Edge(BRepBuilderAPI_MakeEdge(base).Edge()))
        yp = _power([c.Pole(i).Y() for i in range(1,c.NbPoles()+1)])
        t = (yp-y0)/(mid-y0) if yb <= mid+1e-7 else (y1-yp)/(y1-mid)
        h = 3*t*t-2*t*t*t
        degree = max(c.Degree(),len(h.coef)-1)
        assert degree <= 25
        a = _bernstein(h,degree)
        if abs(ya-y0) < 1e-7: a[0]=a[1]=0.
        if abs(yb-y1) < 1e-7: a[-1]=a[-2]=0.
        c.IncreaseDegree(degree)
        poles = TColgp_Array2OfPnt(1,degree+1,1,7)
        for i in range(degree+1):
            point=c.Pole(i+1)
            for j,g in enumerate((0.,0.,0.,3.2,0.,0.,0.)):
                poles.SetValue(i+1,j+1,gp_Pnt(point.X()+peak*a[i]*g,point.Y(),
                                             p.mount_center_z-hz+2*hz*j/6))
        surface=Geom_BezierSurface(poles)
        # Check actual surface evaluation, not only the analytic formula.
        for u in np.linspace(0,1,7):
            for v in (0,.1,.25,.5,.75,.9,1):
                q=surface.Value(float(u),v)
                bc=c.Value(c.FirstParameter()+u*(c.LastParameter()-c.FirstParameter()))
                expected=height(q.Y(),q.Z()-p.mount_center_z,y0,y1,hz,peak)
                assert abs((q.X()-bc.X())-expected) < 2e-6
        faces.append(cq.Face(BRepBuilderAPI_MakeFace(surface,1e-7).Face()))
    first,last=baseline[0].startPoint(),baseline[-1].endPoint()
    outline=baseline+[
        cq.Edge.makeLine(last,(0,y1,0)),cq.Edge.makeLine((0,y1,0),(0,y0,0)),
        cq.Edge.makeLine((0,y0,0),first)]
    cap=cq.Face.makeFromWires(cq.Wire.assembleEdges(outline))
    faces.extend([cap.translate((0,0,p.mount_center_z-hz)),cap.translate((0,0,p.mount_center_z+hz))])
    def rectangle(points):
        return cq.Face.makeFromWires(cq.Wire.makePolygon(points+[points[0]]))
    z0,z1=p.mount_center_z-hz,p.mount_center_z+hz
    faces.extend([
        rectangle([(0,y0,z0),(first.x,y0,z0),(first.x,y0,z1),(0,y0,z1)]),
        rectangle([(0,y1,z0),(last.x,y1,z0),(last.x,y1,z1),(0,y1,z1)]),
        rectangle([(0,y0,z0),(0,y1,z0),(0,y1,z1),(0,y0,z1)])])
    solid=cq.Solid.makeSolid(cq.Shell.makeShell(faces))
    BRepLib.OrientClosedSolid_s(solid.wrapped)
    assert solid.isValid() and solid.Volume() > 0
    return solid
