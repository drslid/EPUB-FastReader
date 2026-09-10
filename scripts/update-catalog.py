#!/usr/bin/env python3
"""Build the browser catalogue from the official Gutenberg RDF snapshot.

Requires Python 3 and rsync. No website crawling or runtime API is involved.
Example: python3 scripts/update-catalog.py --archive /tmp/rdf-files.tar.bz2
Without --archive, download/update the archive in a temporary directory.
"""

import argparse
import hashlib
import json
import re
import subprocess
import tarfile
import tempfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parents[1]
REMOTE = "rsync.ibiblio.org::gutenberg-epub/feeds/rdf-files.tar.bz2"
NS = {
    "p": "http://www.gutenberg.org/2009/pgterms/",
    "d": "http://purl.org/dc/terms/",
    "r": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
}
ABOUT = "{" + NS["r"] + "}about"


def clean(text, limit):
    return re.sub(r"\s+", " ", text or "").strip()[:limit]


def read_records(archive):
    """Read members in place: never extract paths supplied by the archive."""
    records = {}
    with tarfile.open(archive, "r|bz2") as stream:
        for member in stream:
            if not member.isfile() or not member.name.endswith(".rdf"):
                continue
            if member.size > 2 * 1024 * 1024:
                raise ValueError(f"Oversized RDF record: {member.name}")
            document = stream.extractfile(member).read()
            if b"<!DOCTYPE" in document or b"<!ENTITY" in document:
                raise ValueError("RDF entities are not permitted")
            ebook = ElementTree.fromstring(document).find("p:ebook", NS)
            if ebook is None:
                continue
            match = re.fullmatch(r"ebooks/([1-9][0-9]*)", ebook.get(ABOUT, ""))
            if not match or ebook.findtext("d:rights", namespaces=NS) != "Public domain in the USA.":
                continue
            identifier = int(match[1])
            title = clean(ebook.findtext("d:title", namespaces=NS), 300)
            if not title:
                continue
            formats = ebook.findall("d:hasFormat/p:file", NS)
            epub = False
            for file in formats:
                url = urlparse(file.get(ABOUT, ""))
                types = [x.text for x in file.findall("d:format/r:Description/r:value", NS)]
                if ("application/epub+zip" in types and url.scheme == "https"
                        and url.netloc == "www.gutenberg.org"
                        and re.fullmatch(rf"/ebooks/{identifier}\.epub3?\.(?:images|noimages)", url.path)):
                    epub = True
            if not epub:
                continue
            languages = sorted(set(
                item.text for item in ebook.findall("d:language/r:Description/r:value", NS)
                if item.text and re.fullmatch(r"[a-z]{2}", item.text)
            ))
            if not languages:
                continue
            authors = [clean(item.text, 120) for item in ebook.findall("d:creator/p:agent/p:name", NS)]
            author = clean(", ".join(authors[:8]), 500) or "Auteur inconnu"
            downloads = int(ebook.findtext("p:downloads", default="0", namespaces=NS))
            records[identifier] = [identifier, title, author, languages, max(0, downloads)]
    return list(records.values())


def generate(archive):
    records = read_records(archive)
    if len(records) < 50_000:
        raise ValueError("Incomplete catalogue: refusing to replace the checked-in snapshot")
    groups = defaultdict(list)
    for row in sorted(records, key=lambda row: (-row[4], row[0])):
        for language in row[3]:
            groups[language].append(row)
    output = ROOT / "public" / "catalog"
    output.mkdir(exist_ok=True)
    generated = datetime.now(timezone.utc).date().isoformat()
    manifest = {
        "version": 1,
        "generatedAt": generated,
        "source": "https://www.gutenberg.org/ebooks/offline_catalogs.html",
        "archive": REMOTE,
        "sha256": hashlib.file_digest(archive.open("rb"), "sha256").hexdigest(),
        "rights": "Metadata: CC0. Books: public domain in the USA according to the source; check local rights.",
        "count": len(records),
        "languages": {},
    }
    expected = set()
    for language, rows in sorted(groups.items()):
        files = []
        for index in range(0, len(rows), 2500):
            authors = list(dict.fromkeys(row[2] for row in rows[index:index + 2500]))
            author_ids = {name: index for index, name in enumerate(authors)}
            data = {
                "version": 1,
                "language": language,
                "authors": authors,
                "books": [[row[0], row[1], author_ids[row[2]], row[3], row[4]]
                          for row in rows[index:index + 2500]],
            }
            content = json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n"
            digest = hashlib.sha256(content.encode()).hexdigest()[:12]
            name = f"{language}-{index // 2500 + 1}-{digest}.json"
            files.append(name)
            expected.add(name)
            (output / name).write_text(content)
        manifest["languages"][language] = {"count": len(rows), "files": files}
    for existing in output.glob("*.json"):
        if existing.name not in expected:
            existing.unlink()
    (ROOT / "src/sources/catalog-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    )
    size = sum((output / name).stat().st_size for name in expected)
    print(f"{len(records):,} EPUB entries, {len(groups)} languages, {size:,} bytes; snapshot {generated}.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path)
    arguments = parser.parse_args()
    if arguments.archive:
        generate(arguments.archive)
    else:
        with tempfile.TemporaryDirectory(prefix="fastreader-catalog-") as temporary:
            archive = Path(temporary) / "rdf-files.tar.bz2"
            subprocess.run(["rsync", "--timeout=120", REMOTE, str(archive)], check=True)
            generate(archive)
