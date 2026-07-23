#!/usr/bin/env python3
from __future__ import annotations

import os
import plistlib
import shutil
import subprocess
import textwrap
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
SVG_PATH = ASSETS / "cf2000_tracker_icon.svg"
PNG_PATH = ASSETS / "cf2000_tracker_icon_1024.png"
ICONSET_PATH = ASSETS / "CF2000Tracker.iconset"
ICNS_PATH = ASSETS / "CF2000Tracker.icns"

DESKTOP = Path.home() / "Desktop"
MAIN_APP_PATH = DESKTOP / "CF 2000 Tracker.app"
COMPANION_APP_PATH = DESKTOP / "CF 2000 Today.app"
LEGACY_COMMAND_PATH = DESKTOP / "CF 2000 Tracker.command"
PORT = 8765


def run(command: list[str]) -> None:
    subprocess.run(command, check=True)


def render_svg_to_png() -> None:
    render_dir = ASSETS / ".icon_render"
    if render_dir.exists():
        shutil.rmtree(render_dir)
    render_dir.mkdir(parents=True)

    try:
        subprocess.run(
            ["qlmanage", "-t", "-s", "1024", "-o", str(render_dir), str(SVG_PATH)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        run(["sips", "-s", "format", "png", str(SVG_PATH), "--out", str(PNG_PATH)])
        return

    rendered = sorted(render_dir.glob("*.png"))
    if not rendered:
        raise RuntimeError("Quick Look did not render the SVG icon to PNG")
    shutil.copyfile(rendered[0], PNG_PATH)
    shutil.rmtree(render_dir)


def build_icns() -> None:
    if ICONSET_PATH.exists():
        shutil.rmtree(ICONSET_PATH)
    ICONSET_PATH.mkdir(parents=True)

    sizes = [
        ("icon_16x16.png", 16),
        ("icon_16x16@2x.png", 32),
        ("icon_32x32.png", 32),
        ("icon_32x32@2x.png", 64),
        ("icon_128x128.png", 128),
        ("icon_128x128@2x.png", 256),
        ("icon_256x256.png", 256),
        ("icon_256x256@2x.png", 512),
        ("icon_512x512.png", 512),
        ("icon_512x512@2x.png", 1024),
    ]
    for filename, size in sizes:
        run(["sips", "-z", str(size), str(size), str(PNG_PATH), "--out", str(ICONSET_PATH / filename)])

    run(["iconutil", "-c", "icns", str(ICONSET_PATH), "-o", str(ICNS_PATH)])


def launcher_script(url_path: str) -> str:
    return textwrap.dedent(
        f"""\
        #!/bin/zsh
        APP_DIR="{ROOT}"
        PORT={PORT}

        cd "$APP_DIR" || exit 1

        if ! lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
          nohup python3 server.py --port "$PORT" > "$APP_DIR/server.log" 2>&1 &
          sleep 1
        fi

        open "http://127.0.0.1:$PORT{url_path}"
        """
    )


def install_app(app_path: Path, *, display_name: str, executable_name: str, bundle_id: str, url_path: str) -> None:
    contents = app_path / "Contents"
    macos = contents / "MacOS"
    resources = contents / "Resources"

    if app_path.exists():
        shutil.rmtree(app_path)
    macos.mkdir(parents=True)
    resources.mkdir(parents=True)

    executable = macos / executable_name
    executable.write_text(launcher_script(url_path), encoding="utf-8")
    executable.chmod(0o755)

    shutil.copyfile(ICNS_PATH, resources / "CF2000Tracker.icns")
    plist = {
        "CFBundleDevelopmentRegion": "en",
        "CFBundleDisplayName": display_name,
        "CFBundleExecutable": executable_name,
        "CFBundleIconFile": "CF2000Tracker.icns",
        "CFBundleIdentifier": bundle_id,
        "CFBundleInfoDictionaryVersion": "6.0",
        "CFBundleName": display_name,
        "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": "1.1",
        "CFBundleVersion": "2",
        "LSMinimumSystemVersion": "10.13",
        "LSUIElement": True,
        "NSHighResolutionCapable": True,
    }
    with (contents / "Info.plist").open("wb") as file:
        plistlib.dump(plist, file)

    os.utime(app_path, None)


def install_apps() -> None:
    install_app(
        MAIN_APP_PATH,
        display_name="CF 2000 Tracker",
        executable_name="CF2000Tracker",
        bundle_id="local.cf2000-tracker.launcher",
        url_path="/",
    )
    install_app(
        COMPANION_APP_PATH,
        display_name="CF 2000 Today",
        executable_name="CF2000Today",
        bundle_id="local.cf2000-tracker.today",
        url_path="/desktop.html",
    )


def retire_legacy_command() -> None:
    if not LEGACY_COMMAND_PATH.exists():
        return
    text = LEGACY_COMMAND_PATH.read_text(encoding="utf-8", errors="ignore")
    if str(ROOT) not in text or "server.py --port" not in text:
        return

    backup_path = ROOT / "tools" / "CF 2000 Tracker.command.backup"
    backup_path.write_text(text, encoding="utf-8")
    LEGACY_COMMAND_PATH.unlink()


def main() -> None:
    if not SVG_PATH.exists():
        raise FileNotFoundError(SVG_PATH)
    render_svg_to_png()
    build_icns()
    install_apps()
    retire_legacy_command()
    print(f"Installed tracker launcher: {MAIN_APP_PATH}")
    print(f"Installed hover/notification companion: {COMPANION_APP_PATH}")
    print(f"Icon source: {SVG_PATH}")
    print(f"Icon bundle: {ICNS_PATH}")


if __name__ == "__main__":
    main()
