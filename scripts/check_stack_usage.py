#!/usr/bin/env python3
"""Gate compiled frames reachable from the eight application task entries.

Uses compiler .su plus the freshly linked RISC-V ELF disassembly. Direct calls
and tail calls are followed conservatively. Indirect calls, precompiled library
frames and interrupt stack use are NOT a full worst-case stack proof.
"""
import argparse
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TASKS = ['gnss', 'recorder', 'storage', 'supervisor', 'control', 'transport', 'transfer', 'ui']

def canonical(name):
    # GCC .su may say foo.constprop while the ELF says foo.constprop.0.
    return re.sub(r'\.(?:constprop|isra|part)(?:\.\d+)?', '', name)

def reachable(graph, root):
    seen, todo = set(), [root]
    while todo:
        name = todo.pop()
        if name in seen:
            continue
        seen.add(name)
        todo.extend(graph.get(name, ()))
    return seen

def violations(frames, names, allocation):
    return sorted((name, frames[name]) for name in names if frames.get(name, 0) > allocation)

def inspect(build, objdump):
    frames, kinds = {}, {}
    files = list(build.rglob('*.su'))
    if not files:
        raise RuntimeError('No compiler stack-usage files; rebuild with -fstack-usage')
    for path in files:
        for line in path.read_text(errors='replace').splitlines():
            columns = line.split('\t')
            if len(columns) != 3:
                continue
            name = canonical(columns[0].rsplit(':', 1)[-1])
            size = int(columns[1])
            frames[name] = max(size, frames.get(name, 0))
            kinds[name] = columns[2]
    dump = subprocess.check_output([str(objdump), '-d', str(build / 'sailball.elf')], text=True)
    graph, indirect, current = {}, set(), None
    for line in dump.splitlines():
        header = re.match(r'^\w+ <(.+)>:$', line)
        if header:
            current = header[1]
            graph.setdefault(current, set())
        elif current:
            target = re.search(r'\b(?:jal|j|jalr)\s+.*?<([^>]+)>', line)
            if target:
                graph[current].add(target[1].split('+')[0])
            elif re.search(r'\bjalr\b', line):
                indirect.add(current)
    reports, failures = [], []
    # Explicit owner callbacks whose destinations are fixed in this project.
    callbacks = {
        'ui_task': ['ui_status_snapshot'],
        'supervisor_task': ['sb_control_begin_shutdown'],
        'sb_control_usb_response_sent': ['sb_supervisor_request_reboot'],
        'read_logical': ['file_io_read'],
        'sb_ldc_metadata_load': ['file_io_read'],
        'sb_ldc_metadata_publish': ['file_io_read', 'file_io_write', 'file_io_flush'],
        'sb_ldc_metadata_initialize': ['file_io_write', 'file_io_flush'],
        'sb_ldc_block_commit': ['block_commit_write', 'block_commit_flush'],
    }
    for name, targets in callbacks.items():
        if name in graph:
            graph[name].update(target for target in targets if target in graph)
    linked_frames = {name:frames[canonical(name)] for name in graph if canonical(name) in frames}
    for task in TASKS:
        component = 'usb' if task == 'transport' else task
        source = ROOT / 'components' / ('sailball_' + component) / 'src' / (('transport_task' if task == 'transport' else task) + '.c')
        text = source.read_text()
        allocation = int(re.search(r'#define\s+\w+_STACK_(?:WORDS|BYTES)\s+(\d+)', text)[1])
        entry = task + '_task'
        if entry not in graph or entry not in linked_frames:
            raise RuntimeError('Missing linked task or stack-usage entry: ' + entry)
        names = reachable(graph, entry)
        known = sorted(((name, linked_frames[name]) for name in names if name in linked_frames), key=lambda x: x[1], reverse=True)
        bad = violations(linked_frames, names, allocation)
        failures.extend(f'{entry}: {name} frame {size} > stack {allocation}' for name, size in bad)
        dynamic = [name for name in names if canonical(name) in kinds and kinds[canonical(name)] != 'static']
        failures.extend(f'{entry}: unbounded dynamic frame {name}' for name in dynamic if 'bounded' not in kinds[canonical(name)])
        row = dict(task=entry, allocation_bytes=allocation, entry_frame_bytes=frames[entry],
                   largest_known_frames=known[:12], indirect_calls=sorted(names & indirect),
                   missing_frame_count=len(names - linked_frames.keys()), single_frame_gate='FAIL' if bad else 'PASS')
        reports.append(row)
        print(f'{entry}: allocated={allocation} entry={frames[entry]} largest={known[0]} single-frame={row["single_frame_gate"]}')
    result = dict(tasks=reports, failures=failures, scope='Direct ELF calls; indirect/precompiled/interrupt frames require manual and runtime validation')
    (build / 'stack-usage-report.json').write_text(json.dumps(result, indent=2))
    for failure in failures:
        print('FAIL ' + failure)
    print('NOT VERIFIED: complete worst-case call chains (indirect/library/interrupt boundaries)')
    return 1 if failures else 0

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('build', type=Path)
    parser.add_argument('--objdump', default='riscv32-esp-elf-objdump')
    args = parser.parse_args()
    raise SystemExit(inspect(args.build.resolve(), args.objdump))
