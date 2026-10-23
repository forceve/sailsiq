"""Inspect final root faces, their actual neighboring faces and interior curvature.

Unlike the retired feathered-foot validator, this checks the interior of the
transition and has no filter that can discard the front return of the root.
"""
import json, math
from pathlib import Path
import cadquery as cq
from OCP.BRep import BRep_Tool
from OCP.BRepTools import BRepTools
from OCP.BRepClass import BRepClass_FaceClassifier
from OCP.GeomLProp import GeomLProp_SLProps
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_IN, TopAbs_ON
from OCP.TopExp import TopExp
from OCP.TopTools import TopTools_IndexedDataMapOfShapeListOfShape
from OCP.gp import gp_Pnt2d


def validate_root(model, shape):
    # STL export attaches triangulations whose deflection enlarges face boxes.
    # Identify geometric faces independently of this mutable display cache.
    shape = shape.copy(mesh=False)
    zc=model.P.mount_center_z
    blends=[]
    for i,f in enumerate(shape.Faces(),1):
        b=f.BoundingBox()
        if (f.geomType()!='BSPLINE' or b.ymin<0 or b.ymax>55
                or b.zmin<zc-25 or b.zmax>zc+25 or f.Area()<.05
                or not (b.xmin>20 or b.xmax<-20)):
            continue
        surf=BRep_Tool.Surface_s(f.wrapped)
        if (surf.UDegree(),surf.VDegree())==(3,4):continue # original common fork
        if b.ymax<=12.0001:continue # shortened, separate strap locating tabs
        blends.append((i,f,surf))
    assert len(blends)>=4, 'Both roots must contain their complete blend surfaces'
    radii=[];curvature_rows=[]
    for index,face,surface in blends:
        u0,u1,v0,v1=BRepTools.UVBounds_s(face.wrapped)
        values=[]
        for i in range(1,20):
            for j in range(1,50):
                u=u0+(u1-u0)*i/20;v=v0+(v1-v0)*j/50
                state=BRepClass_FaceClassifier(face.wrapped,gp_Pnt2d(u,v),1e-7).State()
                if state not in (TopAbs_IN,TopAbs_ON):continue
                props=GeomLProp_SLProps(surface,u,v,2,1e-9)
                assert props.IsCurvatureDefined()
                radius=1/max(abs(props.MaxCurvature()),abs(props.MinCurvature()),1e-12)
                values.append(radius)
        assert values, f'No interior curvature samples on blend face {index}'
        radii.extend(values)
        curvature_rows.append({'face_index':index,'sample_count':len(values),
                               'minimum_principal_radius_mm':min(values)})
    adj=TopTools_IndexedDataMapOfShapeListOfShape()
    TopExp.MapShapesAndAncestors_s(shape.wrapped,TopAbs_EDGE,TopAbs_FACE,adj)
    seams=[];shell_edges={-1:[],1:[]}
    for i in range(1,adj.Extent()+1):
        edge=cq.Edge(adj.FindKey(i));fs=[cq.Face(f) for f in adj.FindFromIndex(i)]
        if not any(f.isSame(bf) for f in fs for _,bf,_ in blends):continue
        assert len(fs)==2, 'An exposed blend edge has no adjacent material face'
        curve=edge._geomAdaptor();a,b=curve.FirstParameter(),curve.LastParameter()
        pcs=[BRep_Tool.CurveOnSurface_s(edge.wrapped,f.wrapped,0.,0.) for f in fs]
        angles=[]
        for j in range(1,50):
            t=a+(b-a)*j/50
            ns=[f.normalAt(pc.Value(t).X(),pc.Value(t).Y())[0] for f,pc in zip(fs,pcs)]
            angles.append(math.degrees(math.acos(max(-1,min(1,ns[0].dot(ns[1]))))))
        seams.append({'edge_index':i,'maximum_normal_angle_deg':max(angles),
                      'neighbor_types':[f.geomType() for f in fs]})
        if any(f.geomType()=='EXTRUSION' for f in fs):
            shell_edges[1 if edge.Center().x>0 else -1].append(edge)
    closed={str(side):bool(es) and cq.Wire.assembleEdges(es).IsClosed()
            for side,es in shell_edges.items()}
    maximum=max(row['maximum_normal_angle_deg'] for row in seams)
    minimum=min(radii)
    report={'model':model.__name__.split('_')[0], 'passed':all(closed.values()) and maximum<.5 and minimum>=.4,
            'measurement':'Actual final blend boundaries and interior principal curvatures',
            'closed_shell_contact_perimeters':closed,'blend_face_count':len(blends),
            'interior_curvature_sample_count':len(radii),'minimum_principal_radius_mm':minimum,
            'minimum_principal_radius_limit_mm':.4,'maximum_public_root_seam_angle_deg':maximum,
            'maximum_boundary_normal_angle_deg':maximum,'public_root_seams':seams,
            'curvature_by_face':curvature_rows,
            'limits':'Sampled geometric acceptance, not FEA or a proof of stress reduction. Rolling radius is not every principal radius.'}
    return report


if __name__=='__main__':
    from validate_mast_sections import load_models
    out=Path(__file__).resolve().parent/'cadquery_out/v7_experiments'
    for m in load_models():
        prefix=m.__name__.split('_')[0]
        path=out/(prefix+'_v7_raw.brep')
        if not path.exists():continue
        r=validate_root(m,cq.Shape.importBrep(str(path)))
        (out/(prefix+'_v7_root_check.json')).write_text(json.dumps(r,indent=2))
        print(prefix,{k:v for k,v in r.items() if k not in ('public_root_seams','curvature_by_face')},flush=True)
