"""Guard the fixed production v1 metadata publication profile.

This source-shape gate is not a general C call-graph proof. Unrecognized
publication or count mutation requires a manual H04 review.
"""
from pathlib import Path
import re


def uncomment(source: str) -> str:
    return re.sub(r"/\*.*?\*/|//[^\n]*", "", source, flags=re.S)


def verify(storage_source: str, recorder_source: str, ldc_source: str,
           other_sources: str = "") -> None:
    storage = uncomment(storage_source)
    recorder = uncomment(recorder_source)
    ldc = uncomment(ldc_source)
    others = uncomment(other_sources)

    def require(ok: bool, reason: str) -> None:
        if not ok:
            raise ValueError(reason)

    require(re.search(r"#define\s+SB_LDC_MAX_FIELDS\s+64u\b", ldc) is not None,
            "catalog capacity changed")
    require(re.search(r"#define\s+SB_LDC_MAX_DEFINITIONS\s+256u\b", ldc) is not None,
            "definition capacity changed")
    require(len(re.findall(r"\bsb_ldc_metadata_initialize\s*\(", storage)) == 1,
            "file initialization call sites changed")
    require(len(re.findall(r"\bsb_ldc_metadata_publish\s*\(", storage)) == 1,
            "metadata publication call sites changed")
    require(re.search(r"\bsb_ldc_metadata_(?:initialize|publish)\s*\(", others) is None,
            "metadata publication outside Storage owner")
    require(len(re.findall(r"\bpublish_gnss_profile\s*\(", storage)) == 2,
            "profile function/call sites changed")
    require(len(re.findall(r"\bput_catalog_record\s*\(", storage)) == 2,
            "catalog writer/call sites changed")
    require(len(re.findall(r"\bput_definition_record\s*\(", storage)) == 8,
            "definition writer/call sites changed")
    require(re.search(r"for\s*\(uint16_t i\s*=\s*0;\s*i\s*<\s*7;\s*\+\+i\)", storage) is not None,
            "catalog loop changed")
    for field, value in (("field_count", 7), ("definition_count", 7),
                         ("auxiliary_bytes_used", 12)):
        writes = re.findall(r"\b(?:desired|state|s_metadata)\s*(?:\.|->)\s*" + field +
                            r"\s*(?:\+\+|--|(?:\+|-|\*|/)?=(?!=))", storage)
        require(len(writes) == 1, f"{field} mutation paths changed")
        require(re.search(r"\bdesired\." + field + r"\s*=\s*" + str(value) + r"\s*;", storage) is not None,
                f"{field} fixed value changed")
    require("definition_version=1" in recorder and "field <= 7" in recorder,
            "Recorder descriptor range/version changed")
    require("SB_STORAGE_REASON_METADATA_FULL" not in storage,
            "Storage now has a metadata-full production branch")


def self_test(storage: str, recorder: str, ldc: str, others: str) -> None:
    fixtures = {
        "definition count 8": storage.replace("desired.definition_count = 7;", "desired.definition_count = 8;", 1),
        "extra publish call": storage + "\nvoid unexpected(void){ sb_ldc_metadata_publish(0,0,0,0,0,0); }\n",
        "dynamic append": storage.replace("desired.definition_count = 7;",
                                            "desired.definition_count = 7; desired.definition_count++;", 1),
    }
    for name, mutated in fixtures.items():
        if mutated == storage:
            raise ValueError(f"negative fixture did not mutate source: {name}")
        try:
            verify(mutated, recorder, ldc, others)
        except ValueError:
            continue
        raise ValueError(f"negative fixture false PASS: {name}")
    try:
        verify(storage, recorder, ldc,
               others + "\nvoid other_owner(void){sb_ldc_metadata_publish(0,0,0,0,0,0);}\n")
    except ValueError:
        pass
    else:
        raise ValueError("negative fixture false PASS: other-owner publication")


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    storage = (root / "components/sailball_storage/src/storage.c").read_text()
    recorder = (root / "components/sailball_recorder/src/recorder.c").read_text()
    ldc = (root / "components/sailball_ldc/include/sailball/ldc.h").read_text()
    others = "\n".join(path.read_text() for path in sorted((root / "components").rglob("*.c"))
                       if path.name not in {"storage.c", "ldc.c"})
    try:
        verify(storage, recorder, ldc, others)
        self_test(storage, recorder, ldc, others)
    except ValueError as error:
        raise SystemExit("FAIL v1 metadata reachability: " + str(error))
    print("PASS v1 metadata reachability: fixed 7/64 catalog, 7/256 definitions, 12 auxiliary bytes; negative fixtures rejected")


if __name__ == "__main__":
    main()
