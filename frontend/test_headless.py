import asyncio
import base64
import json
import subprocess
import time
import urllib.request
from pathlib import Path
import tempfile
import websockets

TARGET_URL = "http://127.0.0.1:3000/"
OUTPUT_SCREENSHOT = Path(__file__).parent / "test_screenshot.png"


def start_chrome():
    tmp_profile = tempfile.mkdtemp(prefix="chrome_headless_test_")
    cmd = [
        "/usr/bin/google-chrome",
        "--headless=new",
        "--remote-debugging-port=9222",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-extensions",
        f"--user-data-dir={tmp_profile}",
        "--disable-dev-shm-usage",
        TARGET_URL,
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2.0)
    for _ in range(30):
        try:
            with urllib.request.urlopen("http://127.0.0.1:9222/json/list") as resp:
                targets = json.loads(resp.read().decode())
                for t in targets:
                    if t.get("type") == "page" and "127.0.0.1:3000" in t.get("url", ""):
                        return proc, t["webSocketDebuggerUrl"]
        except Exception:
            time.sleep(0.3)
    proc.terminate()
    raise RuntimeError("Could not find page target in Chrome")


async def run():
    print(f"Launching Chrome and navigating to {TARGET_URL}...")
    proc, ws_url = start_chrome()
    print("Connected to Headless Chrome Page Target:", ws_url)
    try:
        async with websockets.connect(ws_url, max_size=30_000_000) as ws:
            req_id = 0

            async def call(method, params=None):
                nonlocal req_id
                req_id += 1
                my_id = req_id
                await ws.send(json.dumps({"id": my_id, "method": method, "params": params or {}}))
                while True:
                    raw = await ws.recv()
                    data = json.loads(raw)
                    if data.get("id") == my_id:
                        if "error" in data:
                            raise RuntimeError(data["error"])
                        return data.get("result", {})

            await call("Page.enable")
            await call("Runtime.enable")

            # Wait until page loads and React mounts
            print("Waiting for page load and React hydration...")
            hydrated = False
            for attempt in range(60):
                await asyncio.sleep(0.5)
                eval_chk = await call(
                    "Runtime.evaluate",
                    {
                        "expression": "!!document.querySelector('.live-indicator-pill') && !!document.querySelector('canvas')",
                        "returnByValue": True,
                    },
                )
                if eval_chk.get("result", {}).get("value") is True:
                    print(f"React hydrated with live indicator pill and Three.js canvas at attempt {attempt + 1}")
                    hydrated = True
                    break

            if not hydrated:
                raise RuntimeError("Page did not hydrate in time")

            # Allow 2.5 seconds for initial data fetches & Three.js rendering
            await asyncio.sleep(2.5)

            # Test 1: Live / Cached indicator pill
            res_pill = await call(
                "Runtime.evaluate",
                {
                    "expression": """
                (() => {
                    const pill = document.querySelector('.live-indicator-pill');
                    return {
                        exists: !!pill,
                        text: pill ? pill.innerText.trim() : null,
                        hasExpectedText: pill ? (pill.innerText.includes('LIVE NASA DATA') || pill.innerText.includes('CACHED NASA DATA')) : false
                    };
                })()
                """,
                    "returnByValue": True,
                },
            )
            val_pill = res_pill.get("result", {}).get("value", {})
            print("\n[TEST 1] Indicator Pill:")
            print(json.dumps(val_pill, indent=2))
            assert val_pill.get("exists"), "Indicator pill missing"
            assert val_pill.get("hasExpectedText"), f"Unexpected pill text: {val_pill.get('text')}"

            # Test 2: Planet X Candidate label
            res_candidate = await call(
                "Runtime.evaluate",
                {
                    "expression": r"""
                (() => {
                    const el = document.querySelector('.provenance-badge.candidate');
                    const text = el ? (el.textContent || el.innerText) : document.body.innerText;
                    return {
                        hasBadge: !!el,
                        badgeText: el ? el.innerText.trim() : null,
                        textContent: el ? el.textContent.trim() : null,
                        matchesCandidate: /candidate\s*[\u2014-]\s*not yet confirmed/i.test(text)
                    };
                })()
                """,
                    "returnByValue": True,
                },
            )
            val_candidate = res_candidate.get("result", {}).get("value", {})
            print("\n[TEST 2] Planet X Candidate Label:")
            print(json.dumps(val_candidate, indent=2))
            assert val_candidate.get("hasBadge"), "Planet X provenance badge element missing"
            assert val_candidate.get("matchesCandidate"), f"Planet X 'Candidate — not yet confirmed' label not found in {val_candidate}"

            # Test 3: Timeline scrubber element
            res_scrubber = await call(
                "Runtime.evaluate",
                {
                    "expression": """
                (() => {
                    const scrubber = document.querySelector('.timeline-scrubber');
                    return {
                        exists: !!scrubber,
                        tagName: scrubber ? scrubber.tagName : null,
                        type: scrubber ? scrubber.type : null,
                        min: scrubber ? scrubber.min : null,
                        max: scrubber ? scrubber.max : null,
                        value: scrubber ? scrubber.value : null
                    };
                })()
                """,
                    "returnByValue": True,
                },
            )
            val_scrubber = res_scrubber.get("result", {}).get("value", {})
            print("\n[TEST 3] Draggable Timeline Scrubber:")
            print(json.dumps(val_scrubber, indent=2))
            assert val_scrubber.get("exists"), "Timeline scrubber element missing"

            # Test 4: Three.js Canvas mounting
            res_canvas = await call(
                "Runtime.evaluate",
                {
                    "expression": """
                (() => {
                    const canvases = Array.from(document.querySelectorAll('canvas'));
                    return {
                        count: canvases.length,
                        details: canvases.map(c => ({
                            width: c.width,
                            height: c.height,
                            clientWidth: c.clientWidth,
                            clientHeight: c.clientHeight
                        }))
                    };
                })()
                """,
                    "returnByValue": True,
                },
            )
            val_canvas = res_canvas.get("result", {}).get("value", {})
            print("\n[TEST 4] Three.js Canvas Viewer:")
            print(json.dumps(val_canvas, indent=2))
            assert val_canvas.get("count", 0) >= 1, "No Three.js canvas element found"

            # Test 5: Autocomplete Dropdown Interaction
            res_autocomplete = await call(
                "Runtime.evaluate",
                {
                    "expression": """
                (() => {
                    const input = document.querySelector('.search-input');
                    if (!input) return { error: 'No .search-input found' };
                    input.focus();
                    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                    setter.call(input, 'Planet');
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));

                    const dropdown = document.querySelector('.autocomplete-dropdown');
                    const items = document.querySelectorAll('.autocomplete-item');
                    return {
                        inputFound: true,
                        dropdownMounted: !!dropdown,
                        itemCount: items.length,
                        itemsSample: Array.from(items).map(it => it.innerText.replace(/\\n/g, ' - '))
                    };
                })()
                """,
                    "returnByValue": True,
                },
            )
            val_autocomplete = res_autocomplete.get("result", {}).get("value", {})
            print("\n[TEST 5] Autocomplete Dropdown:")
            print(json.dumps(val_autocomplete, indent=2))
            assert val_autocomplete.get("dropdownMounted"), "Autocomplete dropdown did not mount on search input"
            assert val_autocomplete.get("itemCount", 0) > 0, "Autocomplete dropdown has no matching items"

            # Set viewport for high-quality screenshot
            await call(
                "Emulation.setDeviceMetricsOverride",
                {
                    "width": 1440,
                    "height": 900,
                    "deviceScaleFactor": 1,
                    "mobile": False,
                },
            )
            await asyncio.sleep(1.0)

            # Capture screenshot
            print(f"\nCapturing screenshot to {OUTPUT_SCREENSHOT}...")
            shot = await call("Page.captureScreenshot", {"format": "png"})
            img_data = base64.b64decode(shot["data"])
            OUTPUT_SCREENSHOT.write_bytes(img_data)
            print(f"Screenshot successfully saved ({len(img_data)} bytes).")
            print("\nALL ASSERTIONS PASSED!")

    finally:
        proc.terminate()
        proc.wait()


if __name__ == "__main__":
    asyncio.run(run())
