from pathlib import Path

from scripts.launcher_revision import calculate_revision, runtime_files


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_launcher_revision_is_stable_and_tracks_runtime_changes(tmp_path: Path) -> None:
    (tmp_path / "package.json").write_text('{"version":"1"}', encoding="utf-8")
    (tmp_path / ".env").write_text("OPENAI_API_KEY=one\n", encoding="utf-8")

    first = calculate_revision(tmp_path, Path(".env"))
    second = calculate_revision(tmp_path, Path(".env"))
    (tmp_path / "package.json").write_text('{"version":"2"}', encoding="utf-8")
    changed_source = calculate_revision(tmp_path, Path(".env"))
    (tmp_path / ".env").write_text("OPENAI_API_KEY=two\n", encoding="utf-8")
    changed_environment = calculate_revision(tmp_path, Path(".env"))

    assert first == second
    assert len(first) == 64
    assert changed_source != first
    assert changed_environment != changed_source


def test_runtime_file_set_excludes_generated_dependencies() -> None:
    relative_files = {
        path.relative_to(PROJECT_ROOT).as_posix()
        for path in runtime_files()
    }

    assert "frontend/package-lock.json" in relative_files
    assert "frontend/app/interview/page.tsx" in relative_files
    assert "scripts/launcher_revision.py" in relative_files
    assert not any("node_modules" in path for path in relative_files)
    assert not any("__pycache__" in path for path in relative_files)


def test_launchers_share_revision_and_release_contract() -> None:
    mac_launcher = (PROJECT_ROOT / "Start AI Interview Simulator.command").read_text()
    windows_launcher = (PROJECT_ROOT / "Start AI Interview Simulator.bat").read_text()
    release_script = (PROJECT_ROOT / "scripts/build-release.sh").read_text()

    assert "scripts/launcher_revision.py --env .env" in mac_launcher
    assert "runtime-revision" in mac_launcher
    assert "scripts\\launcher_revision.py" in windows_launcher
    assert "runtime-revision" in windows_launcher
    assert "Get-NetTCPConnection" in windows_launcher
    assert "launcher_revision.py" in release_script
    assert "pending-revision" not in mac_launcher
    assert mac_launcher.index('>"$LOG_DIR/runtime-revision"') > mac_launcher.index(
        "for _ in {1..180}"
    )
    assert windows_launcher.index('> "%REVISION_FILE%" echo %SOURCE_REVISION%') > (
        windows_launcher.index(":ready")
    )
