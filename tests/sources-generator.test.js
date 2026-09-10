// @vitest-environment node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const execute = promisify(execFile);

it("ne génère que des EPUB explicitement libres et n’extrait aucun chemin de l’archive RDF", async () => {
  const program = String.raw`
import importlib.util, io, json, sys, tarfile, tempfile
from pathlib import Path
spec = importlib.util.spec_from_file_location("catalog", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def rdf(identifier, rights="Public domain in the USA.", mime="application/epub+zip", host="www.gutenberg.org"):
    return f'''<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:pgterms="http://www.gutenberg.org/2009/pgterms/" xmlns:dcterms="http://purl.org/dc/terms/">
<pgterms:ebook rdf:about="ebooks/{identifier}"><dcterms:title>Titre {identifier}</dcterms:title><dcterms:rights>{rights}</dcterms:rights>
<dcterms:creator><pgterms:agent><pgterms:name>Auteur</pgterms:name></pgterms:agent></dcterms:creator>
<dcterms:language><rdf:Description><rdf:value>fr</rdf:value></rdf:Description></dcterms:language>
<dcterms:hasFormat><pgterms:file rdf:about="https://{host}/ebooks/{identifier}.epub3.images"><dcterms:format><rdf:Description><rdf:value>{mime}</rdf:value></rdf:Description></dcterms:format></pgterms:file></dcterms:hasFormat>
</pgterms:ebook></rdf:RDF>'''.encode()

with tempfile.TemporaryDirectory(prefix="fastreader-rdf-test-") as temporary:
    archive = Path(temporary) / "input.tar.bz2"
    records = [rdf(1), rdf(2, rights="Copyrighted."), rdf(3, rights=""), rdf(4, mime="text/plain"), rdf(5, host="evil.test")]
    with tarfile.open(archive, "w:bz2") as tar:
        for index, data in enumerate(records):
            info = tarfile.TarInfo(f"../../must-not-extract-{index}.rdf")
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    result = module.read_records(archive)
    assert [row[0] for row in result] == [1], result
    assert list(Path(temporary).iterdir()) == [archive]
    try:
        module.generate(archive)
        raise AssertionError("An incomplete snapshot must not replace the checked-in catalogue")
    except ValueError as error:
        assert "Incomplete catalogue" in str(error)
    print(json.dumps(result))
`;
  const result = await execute("python3", [
    "-B",
    "-c",
    program,
    resolve("scripts/update-catalog.py"),
  ]);
  expect(JSON.parse(result.stdout)).toEqual([
    [1, "Titre 1", "Auteur", ["fr"], 0],
  ]);
});
