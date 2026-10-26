"""Build-only source archive: explicit product roots, no local output or secrets."""
from pathlib import Path
import sys
import zipfile

source, destination = map(Path, sys.argv[1:])
allowed = ["README.md", "install.ps1", ".gitattributes", ".gitignore", ".agents/plugins/marketplace.json", ".claude-plugin/marketplace.json", "docs", "installer", "scripts", "plugins/copilot-discussion"]
excluded = {"output", ".git", "node_modules", ".venv", "__pycache__"}
with zipfile.ZipFile(destination, "x", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for name in allowed:
        item = source / name
        if not item.exists():
            continue
        files = [item] if item.is_file() else sorted(item.rglob("*"))
        for file in files:
            relative = file.relative_to(source)
            if any(p in excluded or p == ".env" or p.startswith(".env.") for p in relative.parts) or file.suffix.lower() in {".pyc", ".pfx", ".p12", ".key"}:
                continue
            if file.is_symlink():
                raise ValueError("Source archive cannot include links")
            if file.is_file():
                archive.write(file, relative.as_posix())
