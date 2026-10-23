"""Stage and validate all three mounts before publishing their CAD exports."""
from dataclasses import asdict
from pathlib import Path
import json, shutil, sys
from validate_mast_sections import load_models
from validate_tree_bracing import validate
from validate_root_blend_v7 import validate_root
from normalize_cad_edges import verify_native_bop
import tree_bracing as tree

root=Path(__file__).resolve().parent
baseline={r['model']:r for r in json.loads((root/'tree_bracing_baseline.json').read_text())['models']}
reports=[]; outputs=[]
only = next((a.split('=',1)[1] for a in sys.argv if a.startswith('--only=')),None)
publish = '--publish-checked' in sys.argv
for model in load_models():
    prefix=model.__name__.split('_')[0]
    if only and prefix != only:continue
    original=model.OUT_DIR
    model.OUT_DIR=root/'cadquery_out/tree_v7_staging'/prefix
    model.OUT_DIR.mkdir(parents=True,exist_ok=True)
    if publish:
        report=json.loads((model.OUT_DIR/'tree_bracing_validation.json').read_text(encoding='utf-8'))
        assert report['revision']==tree.DESIGN.revision and report['root_surface_continuity']['passed']
        fits=json.loads((root/'cadquery_out/root_transition_v7/fork_profile_fit_validation.json').read_text())
        fit=next(r for r in fits if r['model']==prefix)
        assert fit['parameters']==report['fork_construction']['root_section_parameters']
        assert max(fit['sampled_profile_error_mm'].values())<fit['limit_mm']
        report['fork_construction']['sampled_profile_error_mm']=fit['sampled_profile_error_mm']
        report['connector']['solid_volume_reduction_percent']=None
        report['connector']['comparison_note']='Display-only reference has a new trim definition; compare full bracket volumes instead.'
        (model.OUT_DIR/'tree_bracing_validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
        reports.append(report);outputs.append((model.OUT_DIR,original))
        continue
    print(prefix,'building full manufacturing solid',flush=True)
    body=tree.make_integrated_bracket(model,model.P).val()
    check=validate_root(model,body)
    print(prefix,'root check',check['passed'],check['minimum_principal_radius_mm'],check['maximum_boundary_normal_angle_deg'],flush=True)
    assert check['passed']
    print(prefix,'exporting',flush=True)
    if prefix=='j80':model.export_all()
    else:model.export_all(include_cross_boat_reference=False)
    for kind in ('mount','connector'):
        verify_native_bop(model.OUT_DIR/f'{prefix}_tree_bracing_{kind}.brep')
    print(prefix,'native BOP passed',flush=True)
    reports.append(validate(model,baseline[prefix]))
    outputs.append((model.OUT_DIR,original))
if only:
    print(only,'staged validation complete',flush=True)
    raise SystemExit(0)
report={'design':asdict(tree.DESIGN),'models':reports}
for stage,destination in outputs:
    for path in stage.iterdir():
        if path.is_file():shutil.copy2(path,destination/path.name)
(root/'cadquery_out/tree_bracing_validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print('All three V7 CAD exports published after validation',flush=True)
