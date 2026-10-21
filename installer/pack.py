"""Build-only archive operations; never runs on the destination computer."""
import hashlib
import json
import pathlib
import sys
import tarfile
import zipfile

command, *args = sys.argv[1:]
if command == "python":
    archive, destination = map(pathlib.Path, args)
    with tarfile.open(archive, "r:gz") as tar:
        tar.extractall(destination, filter="data")
elif command == "licenses":
    wheels, destination = map(pathlib.Path, args)
    for wheel in wheels.glob("*.whl"):
        with zipfile.ZipFile(wheel) as archive:
            for entry in archive.infolist():
                parts = pathlib.PurePosixPath(entry.filename).parts
                if entry.is_dir() or ".." in parts:
                    continue
                if any(part.lower().startswith(("license", "copying", "notice")) for part in parts):
                    target = destination / wheel.stem / pathlib.Path(*parts)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(archive.read(entry))
elif command == "zip":
    source, destination = map(pathlib.Path, args)
    with zipfile.ZipFile(destination, "x", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for file in sorted(source.rglob("*")):
            if file.is_symlink():
                raise ValueError(f"No links in release: {file}")
            if file.is_file():
                archive.write(file, file.relative_to(source).as_posix())
    print(json.dumps({"bytes": destination.stat().st_size, "sha256": hashlib.file_digest(destination.open("rb"), "sha256").hexdigest()}))
else:
    raise ValueError("Unknown archive operation")
