"""Report fresh ELF RAM objects and raw C3 heap address ranges (not free heap)."""
import argparse
import hashlib
import json
from pathlib import Path
from elftools.elf.elffile import ELFFile

def main(build):
    elf_path=build/'sailball.elf'
    with elf_path.open('rb') as stream:
        elf=ELFFile(stream)
        sections={section.name: dict(address=section['sh_addr'], bytes=section['sh_size'])
                  for section in elf.iter_sections() if section['sh_flags'] & 2}
        symbols=list(elf.get_section_by_name('.symtab').iter_symbols())
        values={symbol.name:symbol['st_value'] for symbol in symbols}
        # Local static symbols retain STT_FILE association in GCC's symbol table.
        owner=''
        objects=[]
        owners={'ble.c','board.c','common.c','control.c','diagnostics.c','gnss.c','ldc.c',
                'recorder.c','storage.c','supervisor.c','system.c','transfer.c','transport_task.c','ui.c','usb.c'}
        owners.add('wifi.c')
        for symbol in symbols:
            if symbol['st_info']['type']=='STT_FILE':
                owner=symbol.name
            if symbol['st_info']['type']!='STT_OBJECT' or not symbol['st_size']:
                continue
            address=symbol['st_value']
            index=symbol['st_shndx']
            if not isinstance(index,int) or not 0x3FC80000<=address<0x3FCE0000:
                continue
            section=elf.get_section(index).name
            if owner not in owners:
                continue
            classification='UNKNOWN'
            if symbol.name in {'s_pool','s_block_pool','s_transfer_metadata'}:
                classification='KEEP'
            elif symbol.name in {'s_fix_queue_storage'} or symbol.name=='s_stack':
                classification='KEEP'
            elif 'queue_storage' in symbol.name or 'q_data' in symbol.name or symbol.name in {
                's_metadata_workspace','s_rx_buffer','s_tx_buffer','s_tx_item','s_encode_scratch','s_control_response'}:
                classification='OPTIMIZE'
            elif symbol.name in {'s_scan_buffer','s_samples','s_out','s_encoded','s_decoded','s_payload','s_rx_frame','s_tx_frame'}:
                classification='CONDITIONAL'
            objects.append(dict(owner=owner,symbol=symbol.name,bytes=symbol['st_size'],
                                section=section,address=hex(address),classification=classification))
        objects.sort(key=lambda row:row['bytes'],reverse=True)
        bounds={name:hex(values[name]) for name in ['_data_start','_data_end','_bss_start','_bss_end',
                  '_heap_start','_iram_start','_iram_end','_rtc_force_slow_end'] if name in values}
        # IDF 6.1 C3 memory_layout.c and soc.h: APP_USABLE_DRAM_END=0x3fcdc710.
        initial_end=0x3FCDC710
        heap_start=values['_heap_start']
        raw=max(0,initial_end-heap_start)
        later=0x3FCE0000-initial_end
        sailball_static=sum(row['bytes'] for row in objects)
        linked_data=sections.get('.dram0.bss',{}).get('bytes',0)+sections.get('.dram0.data',{}).get('bytes',0)
        result=dict(elf_sha256=hashlib.sha256(elf_path.read_bytes()).hexdigest(),sections=sections,bounds=bounds,
                    raw_initial_main_ram_tail_bytes=raw,raw_startup_reserved_span_bytes=later,
                    raw_total_main_ram_tail_bytes=raw+later,objects=objects,
                    sailball_owned_static_data_bytes=sailball_static,
                    linked_non_sailball_or_unattributed_data_bytes=max(0,linked_data-sailball_static),
                    linked_bss_data_bytes=linked_data,
                    warning='Optimistic raw address spans. IDF memory_layout_utils.c additionally excludes ROM layout dram0_rtos_reserved_start..SOC_DIRAM_DRAM_HIGH at runtime. Startup span is not wholly reclaimable. Subtract allocator metadata and runtime allocations; not measured free heap.')
        (build/'memory-budget.json').write_text(json.dumps(result,indent=2))
        print(json.dumps({k:v for k,v in result.items() if k not in {'objects','sections'}},indent=2))
        for name,row in sections.items():
            if name.startswith(('.dram','.iram','.rtc')): print(name,row)
        print('| Owner / symbol | Bytes | Section | Classification |\n| --- | ---: | --- | --- |')
        for row in objects[:30]:
            print(f'| {row["owner"]} / {row["symbol"]} | {row["bytes"]} | {row["section"]} | {row["classification"]} |')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('build',type=Path)
    main(parser.parse_args().build.resolve())
