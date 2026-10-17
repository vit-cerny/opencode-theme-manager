#!/usr/bin/env python
"""Real-browser acceptance check for the OpenCode Theme Manager (optional tool, not a repo dependency).

    python tools/ui-e2e.py

Starts its own server on a throwaway config dir, drives the real UI in headless Chrome via Playwright
(uses your installed Chrome through channel="chrome"), asserts the flows that matter, and writes
docs/ui-check.png. Needs: pip install playwright. The repo's own checks are `node --test test/`.
"""

import re
import shutil
import socket
import subprocess
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parent.parent
CHROME = next((candidate for candidate in [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
] if Path(candidate).exists()), None)
DEBUG_PORT = 9222  # the port the manager probes, so its own discovery finds this browser
fails: list[str] = []


def port_open(port: int) -> bool:
    with socket.socket() as sock:
        sock.settimeout(0.4)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def check(ok: bool, label: str, extra: str = "") -> None:
    print(("ok   " if ok else "FAIL ") + label + (f"  [{extra}]" if extra else ""))
    if not ok:
        fails.append(label)


def main() -> int:
    profile = tempfile.mkdtemp(prefix="octm-pw-")
    server = subprocess.Popen(
        ["node", "server.mjs", "--port", "0", "--no-open", "--config-dir", str(Path(profile) / "cfg"), "--desktop-profile", str(Path(profile) / "appdata")],
        cwd=REPO, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    port = None
    for _ in range(60):
        match = re.search(r"127\.0\.0\.1:(\d+)", server.stdout.readline() or "")
        if match:
            port = match.group(1)
            break
    if not port:
        print("FAIL server did not start")
        return 1
    base = f"http://127.0.0.1:{port}/"
    debug_port_free = not port_open(DEBUG_PORT)
    chrome = None

    try:
        with sync_playwright() as playwright:
            # Launch Chrome ourselves with a DevTools port so the manager's own discovery finds this
            # page - Playwright's built-in launcher uses a pipe and would have no port to probe.
            if CHROME and debug_port_free:
                chrome = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", "--no-first-run",
                                           f"--user-data-dir={Path(profile) / 'chrome'}",
                                           f"--remote-debugging-port={DEBUG_PORT}", base],
                                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                browser = None
                for _ in range(40):
                    try:
                        browser = playwright.chromium.connect_over_cdp(f"http://127.0.0.1:{DEBUG_PORT}")
                        break
                    except Exception:
                        import time
                        time.sleep(0.5)
                assert browser, "could not attach to the debugged Chrome"
                page = browser.contexts[0].pages[0]
            else:
                page = playwright.chromium.launch(channel="chrome", headless=True).new_page(viewport={"width": 1600, "height": 1000})

            errors: list[str] = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(base)
            page.wait_for_load_state("networkidle")
            page.wait_for_selector("#status")
            page.wait_for_function("() => document.querySelectorAll('.hue-cell').length > 20")

            check(page.locator(".rail .panel > summary").count() == 9, "nine panels render")
            check(page.locator(".hue-cell").count() >= 20, "hue ladders render", str(page.locator(".hue-cell").count()))
            check(page.locator(".token-row").count() > 50, "token rows render", str(page.locator(".token-row").count()))

            page.click("summary:has-text('Desktop app')")
            page.wait_for_function("() => /bundled themes/.test(document.getElementById('desktopInfo').textContent)")
            check("bundled themes" in (page.text_content("#desktopInfo") or ""), "desktop panel reports the app")

            # The preview must not promise the GUI what its window cannot do (no transparent/Mica flag).
            page.click(".tab[data-view='desktop']")
            page.wait_for_function("() => /no wallpaper can show through/i.test(document.getElementById('stageNote').textContent)")
            flat = page.evaluate("getComputedStyle(document.getElementById('wallpaper')).backgroundImage")
            check(flat == "none", "desktop preview drops the wallpaper it cannot have", flat[:24])
            page.click(".tab[data-view='tui']")
            page.wait_for_function("() => /terminal compositor/i.test(document.getElementById('stageNote').textContent)")
            check(True, "CLI preview says where its see-through comes from")

            before = page.evaluate("getComputedStyle(document.getElementById('tui')).getPropertyValue('--oc-bg')")
            page.fill("#prompt", "nord blue frosted glass rounded corners jetbrains mono 60% transparent")
            page.click("#btnGenerate")
            page.wait_for_function("() => /understood/.test(document.getElementById('matched').textContent)")
            after = page.evaluate("getComputedStyle(document.getElementById('tui')).getPropertyValue('--oc-bg')")
            check(before != after, "a prompt restyles the live preview", f"{before.strip()} -> {after.strip()}")
            check("valid" in (page.text_content("#validation") or ""), "generated theme validates")

            if CHROME and debug_port_free:
                # The page stands in for the app: its preload sets data-theme on <html>.
                page.evaluate("document.documentElement.setAttribute('data-theme','oc-2')")
                page.click("#btnDesktopGlass")
                page.wait_for_function("() => localStorage.getItem('opencode-theme-css-dark') !== null")
                stored = page.evaluate("localStorage.getItem('opencode-theme-css-dark').length")
                applied = page.evaluate("(document.getElementById('oc-theme-preload') || {}).textContent?.length || 0")
                check(stored > 1000, "desktop CSS stored", f"{stored} bytes")
                check(applied == stored, "desktop CSS applied live, no reload", f"{applied} bytes")
            else:
                print("skip desktop apply (no free DevTools port / no Chrome)")

            page.screenshot(path=str(REPO / "docs" / "ui-check.png"), full_page=True)
            check((REPO / "docs" / "ui-check.png").stat().st_size > 20_000, "screenshot captured")
            check(not errors, "no page errors", "; ".join(errors[:2]))
    finally:
        server.terminate()
        if chrome:
            subprocess.run(["taskkill", "/PID", str(chrome.pid), "/T", "/F"], capture_output=True)
        shutil.rmtree(profile, ignore_errors=True)

    print("\n" + ("PLAYWRIGHT PASS" if not fails else f"PLAYWRIGHT FAIL: {fails}"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())

