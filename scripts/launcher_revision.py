#!/usr/bin/env python3
"""Compute the runtime fingerprint shared by the macOS and Windows launchers."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
RUNTIME_PATHS = (
    Path("package.json"),
    Path("backend/requirements.txt"),
    Path("frontend/package.json"),
    Path("frontend/package-lock.json"),
    Path("frontend/next.config.ts"),
    Path("frontend/tsconfig.json"),
    Path("backend"),
    Path("director"),
    Path("reporting"),
    Path("frontend/app"),
    Path("frontend/lib"),
    Path("frontend/public"),
    Path("scripts/launcher_revision.py"),
)
IGNORED_PARTS = {
    ".DS_Store",
    ".next",
    "__pycache__",
    "node_modules",
}
IGNORED_SUFFIXES = {".pyc", ".pyo"}


def runtime_files(project_root: Path = PROJECT_ROOT) -> list[Path]:
    files: list[Path] = []
    for relative_path in RUNTIME_PATHS:
        path = project_root / relative_path
        if path.is_file():
            files.append(path)
            continue
        if path.is_dir():
            files.extend(
                candidate
                for candidate in path.rglob("*")
                if candidate.is_file()
                and not IGNORED_PARTS.intersection(candidate.relative_to(project_root).parts)
                and candidate.suffix not in IGNORED_SUFFIXES
            )
    return sorted(set(files), key=lambda path: path.relative_to(project_root).as_posix())


def calculate_revision(
    project_root: Path = PROJECT_ROOT,
    environment_file: Path | None = None,
) -> str:
    digest = hashlib.sha256()
    files = runtime_files(project_root)
    if environment_file is not None:
        resolved_environment = (
            environment_file
            if environment_file.is_absolute()
            else project_root / environment_file
        )
        files.append(resolved_environment)

    for path in sorted(
        set(files),
        key=lambda candidate: candidate.relative_to(project_root).as_posix(),
    ):
        relative_path = path.relative_to(project_root).as_posix()
        digest.update(relative_path.encode("utf-8"))
        digest.update(b"\0")
        with path.open("rb") as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(block)
        digest.update(b"\0")
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--env",
        type=Path,
        help="Include this project-relative environment file in the fingerprint.",
    )
    arguments = parser.parse_args()
    print(calculate_revision(environment_file=arguments.env))


if __name__ == "__main__":
    main()
