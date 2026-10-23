"""Download the public manufacturer references used in the specification audit."""
from pathlib import Path
from datetime import date
import hashlib
import json
import requests

ROOT = Path(__file__).resolve().parent
SOURCES = {
    "selden_keelboat_catalogue.pdf": "https://support.seldenmast.com/files/1681308368/595-950-E.pdf",
    "sparcraft_s_sections.jpg": "https://www.sparcraft.com/wp-content/uploads/2021/11/sections_S_sparcraft.jpg",
    "sparcraft_s_masts.pdf": "https://www.sparcraft.com/wp-content/uploads/2021/07/Mast_s_2019_fr_lgt.pdf",
}

if __name__ == "__main__":
    records = []
    for name, url in SOURCES.items():
        response = requests.get(url, timeout=45)
        response.raise_for_status()
        if "text/html" in response.headers.get("Content-Type", ""):
            raise ValueError(f"Received HTML instead of source document: {url}")
        (ROOT / name).write_bytes(response.content)
        records.append({"file": name, "url": url, "retrieved": date.today().isoformat(), "bytes": len(response.content),
                        "sha256": hashlib.sha256(response.content).hexdigest()})
        print(name, len(response.content), flush=True)
    (ROOT / "downloads.json").write_text(json.dumps(records, indent=2), encoding="utf-8")
