"""Exploratory J80 V1/V2 linear comparison, mm/N. Not a load qualification.

Requires Gmsh/CalculiX and native-checked BREP files in cadquery_out/fea.
Straight-sided C3D10 elements avoid curved midside-node inversion; this is a
faceted geometry approximation and must be compared at two mesh sizes.
"""
from pathlib import Path
import argparse
import json
import os
import re
import subprocess
import numpy as np
from scipy.spatial import cKDTree
from mast_section import IMS80

OUT = Path(__file__).resolve().parent/'cadquery_out/fea'
BIN = Path('E:/FreeCAD_1.1/bin')


def read_mesh(path):
    nodes, elements, mode = {}, [], ''
    for line in path.read_text().splitlines():
        if line.startswith('*'):
            mode = 'node' if line.upper() == '*NODE' else ('tet' if line.upper().startswith('*ELEMENT, TYPE=C3D10') else '')
            continue
        if not line.strip():
            continue
        values = [v.strip() for v in line.split(',') if v.strip()]
        if mode == 'node':
            nodes[int(values[0])] = list(map(float, values[1:4]))
        elif mode == 'tet':
            elements.append(list(map(int, values)))
    ids = np.array(sorted(nodes))
    assert np.array_equal(ids, np.arange(1, len(ids)+1))
    return np.array([nodes[i] for i in ids]), np.array(elements)


def prepare(revision, size):
    name = f'{revision}_h{size:g}'
    geo = OUT/f'{name}.geo'
    geo.write_text(f'''SetFactory("OpenCASCADE");
Merge "{(OUT/(revision+'.brep')).as_posix()}";
Mesh.MeshSizeMin = 1.0;
Mesh.MeshSizeMax = {size};
Mesh.MeshSizeFromCurvature = 0;
Mesh.MeshSizeFromPoints = 0;
Mesh.ElementOrder = 2;
Mesh.SecondOrderLinear = 1;
Mesh.Algorithm3D = 1;
Mesh.Optimize = 1;
Physical Volume("SOLID") = {{1}};
''')
    mesh = OUT/f'{name}_mesh.inp'
    mesh.unlink(missing_ok=True)
    r = subprocess.run([str(BIN/'gmsh.exe'),str(geo),'-3','-nopopup','-nt','4','-o',str(mesh),'-format','inp'],capture_output=True,text=True)
    (OUT/f'{name}_mesh.log').write_text(r.stdout+r.stderr)
    assert r.returncode == 0 and mesh.exists() and not re.search(r'(?m)^Error\s*:', r.stdout+r.stderr)
    xyz, elements = read_mesh(mesh)
    conn = elements[:,1:]-1
    corners = xyz[conn[:,:4]]
    det = np.linalg.det(np.stack([corners[:,i]-corners[:,0] for i in (1,2,3)],axis=2))
    assert np.all(det > 0), 'Inverted or zero-volume tetrahedron'
    # Select boundary triangles by their corner-node incidence. Abaqus C3D10
    # midside order: 12,23,31,14,24,34. Straight triangles integrate uniform
    # tractions exactly with zero corner force and area/3 at each midside node.
    face_map = np.array([[0,1,2,4,5,6],[0,1,3,4,8,7],
                         [0,2,3,6,9,7],[1,2,3,5,9,8]])
    faces = conn[:,face_map].reshape(-1,6)
    _, inv, counts = np.unique(np.sort(faces[:,:3],axis=1),axis=0,return_inverse=True,return_counts=True)
    boundary = faces[counts[inv] == 1]
    centroid = xyz[boundary[:,:3]].mean(axis=1)
    front = boundary[(np.max(np.abs(xyz[boundary,1]-90.3),axis=1)<1e-5)
                     & (np.abs(centroid[:,0])<66) & (np.abs(centroid[:,2]-600)<49)]
    tri = xyz[front[:,:3]]
    area = np.linalg.norm(np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]),axis=1)/2
    weight = np.zeros(len(xyz))
    np.add.at(weight,front[:,3:].ravel(),np.repeat(area/3,3))
    weight /= weight.sum()
    load = np.flatnonzero(weight)
    wire = IMS80.envelope_wire(82,133,3)
    samples = np.array([v.toTuple()[:2] for v in wire.sample(12000)[0]])
    distance = cKDTree(samples).query(xyz[:,:2])[0]
    band = np.abs(np.abs(xyz[:,2]-600)-34)<=15+1e-6
    surface_nodes = np.unique(boundary)
    fixed = np.intersect1d(np.flatnonzero((distance<0.08)&band),surface_nodes)
    assert len(fixed)>100 and len(load)>100
    forces = []
    for axis in range(3):
        f = np.zeros_like(xyz); f[:,axis] = weight
        forces.append(f)
    f = np.zeros_like(xyz)
    xc = xyz[:,0]-np.dot(weight,xyz[:,0])
    f[:,1] = 100*weight*xc/np.dot(weight,xc*xc)
    forces.append(f)
    lines = ['*HEADING',f'J80 {name}; E=1000 MPa reference; fixed inner strap bands',mesh.read_text()[mesh.read_text().index('*NODE'):],
             '*MATERIAL,NAME=REFERENCE','*ELASTIC','1000.,0.35',
             '*SOLID SECTION,ELSET=SOLID,MATERIAL=REFERENCE','*NSET,NSET=FIXED']
    lines.extend(','.join(map(str,fixed[i:i+12]+1)) for i in range(0,len(fixed),12))
    lines.append('*NSET,NSET=LOAD')
    lines.extend(','.join(map(str,load[i:i+12]+1)) for i in range(0,len(load),12))
    lines.extend(['*BOUNDARY','FIXED,1,3'])
    for force in forces:
        lines.extend(['*STEP','*STATIC','*CLOAD,OP=NEW'])
        for node,axis in np.argwhere(force!=0):
            lines.append(f'{node+1},{axis+1},{force[node,axis]:.12g}')
        lines.extend(['*NODE PRINT,NSET=LOAD','U','*NODE PRINT,NSET=FIXED','RF','*END STEP'])
    (OUT/f'{name}.inp').write_text('\n'.join(lines)+'\n')
    np.savez_compressed(OUT/f'{name}_loads.npz',xyz=xyz,load=load,fixed=fixed,forces=np.array(forces))
    meta = {'name':name,'nodes':len(xyz),'tetrahedra':len(elements),'mesh_volume_mm3':float(det.sum()/6),
            'smallest_tet_mm3':float(det.min()/6),'negative_tets':0,'fixed_nodes':len(fixed),
            'loaded_nodes':len(load),'loaded_area_mm2':float(area.sum()),
            'mesh_warnings':[s.strip() for s in (r.stdout+r.stderr).splitlines() if 'Warning :' in s],
            'force_sums':[f.sum(axis=0).tolist() for f in forces],
            'moments_about_panel_centre':[np.cross(xyz-[0,90.3,600],f).sum(axis=0).tolist() for f in forces]}
    (OUT/f'{name}_setup.json').write_text(json.dumps(meta,indent=2))
    print(json.dumps(meta),flush=True)
    return name


def solve(name):
    env = dict(os.environ,OMP_NUM_THREADS='4',NUMBER_OF_CPUS='4')
    (OUT/f'{name}.dat').unlink(missing_ok=True)
    r = subprocess.run([str(BIN/'ccx.exe'),'-i',name],cwd=OUT,env=env,capture_output=True,text=True)
    (OUT/f'{name}_solve.log').write_text(r.stdout+r.stderr)
    assert r.returncode == 0 and '*ERROR' not in r.stdout+r.stderr, (r.stdout+r.stderr)[-2000:]
    read_results(name)


def read_results(name):
    arrays = dict(np.load(OUT/f'{name}_loads.npz'))
    displacements, reactions, active = [], [], None
    for line in (OUT/f'{name}.dat').read_text().splitlines():
        if 'displacements (' in line:
            displacements.append({}); active=displacements[-1]
        elif 'forces (' in line:
            reactions.append({}); active=reactions[-1]
        elif active is not None:
            values=line.split()
            if len(values)==4 and values[0].isdigit():
                active[int(values[0])-1]=np.array(list(map(float,values[1:])))
    assert len(displacements)==4 and len(reactions)==4
    rows=[]
    for i,case in enumerate(('Fx_1N','Fy_1N','Fz_1N','Mz_100Nmm')):
        force=arrays['forces'][i]
        compliance=sum(np.dot(force[n],v) for n,v in displacements[i].items())
        reaction=np.sum(list(reactions[i].values()),axis=0)
        reaction_moment=sum(np.cross(arrays['xyz'][n]-[0,90.3,600],v) for n,v in reactions[i].items())
        applied_moment=np.cross(arrays['xyz']-[0,90.3,600],force).sum(axis=0)
        assert np.linalg.norm(reaction_moment+applied_moment)<1e-3
        assert np.linalg.norm(reaction+force.sum(axis=0))<1e-4
        rows.append({'case':case,'compliance_Nmm':float(compliance),'strain_energy_Nmm':float(compliance/2),
                     'max_loaded_node_displacement_mm':float(max(np.linalg.norm(v) for v in displacements[i].values())),
                     'reaction_sum_N':reaction.tolist(),'reaction_moment_Nmm':reaction_moment.tolist()})
    (OUT/f'{name}_results.json').write_text(json.dumps(rows,indent=2))
    print(name,rows,flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('revision',choices=['v1','v2','v2_reinforced','v2_final','v3_j80','v3_final']);parser.add_argument('--size',type=float,default=4)
    args=parser.parse_args();solve(prepare(args.revision,args.size))
