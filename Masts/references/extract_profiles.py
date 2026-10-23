"""Extract catalogue paths (PDF points, y down); requires pdfplumber.

The catalogue drawings are illustrations, not certified extrusion drawings.
Keep raw paths for overlays and the separately selected body for smooth CAD.
"""
import json
from pathlib import Path
import pdfplumber

ROOT = Path(__file__).resolve().parent


def extract():
    selden = pdfplumber.open(ROOT / "selden_keelboat_catalogue.pdf").pages[9]
    sparcraft = pdfplumber.open(ROOT / "sparcraft_s_masts.pdf").pages[1]
    # Outer right half from the generic C-section illustration, stopping before
    # the lip return. Remove the two tiny drafting kinks at maximum beam.
    raw = [cmd[-1] for cmd in selden.curves[6]["path"][:43]]
    right = [xy for i, xy in enumerate(raw) if i not in (24, 25)]
    # Store all original paths as an independent plotting/reference layer.
    result = {
        "selden_c": {
            "source": "selden_keelboat_catalogue.pdf", "page": 10,
            "basis": "Generic C-series catalogue illustration, normalised to each nominal size",
            "center_x": 102.3217, "nose_y": 477.0059, "top_y": 570.5189,
            "half_width": 133.1327 - 102.3217,
            "raw_paths": [selden.curves[i]["path"] for i in (4, 5, 6, 7)],
            "outer_right": right,
        },
        "ims80": {
            "source": "sparcraft_s_masts.pdf", "page": 2,
            "basis": "S80 catalogue outer Beziers; IMS-80 dimensions corroborated by Rig-Rite",
            "center_x": 268.91, "nose_y": 150.219, "top_y": 201.684,
            "half_width": 284.857 - 268.91,
            "raw_paths": [sparcraft.curves[i]["path"] for i in range(2942, 2964)],
            "outer_beziers": [
                [[268.91,150.219],[273.318,150.219],[277.357,152.675],[279.387,156.586]],
                [[279.387,156.586],[283.014,163.576],[284.857,171.272],[284.857,179.006]],
                [[284.857,179.006],[284.857,183.797],[284.150,188.602],[282.722,193.264]],
                [[282.722,193.264],[281.763,196.394],[279.445,198.923],[276.411,200.148]],
                [[276.411,200.148],[273.366,201.379]],
                [[273.366,201.379],[272.866,201.580],[272.332,201.684],[271.793,201.684]],
            ],
        },
    }
    (ROOT / "profile_traces.json").write_text(json.dumps(result, indent=2), encoding="utf-8")


if __name__ == "__main__":
    extract()
