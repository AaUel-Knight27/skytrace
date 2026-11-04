import asyncio
import json
import subprocess
import time
import urllib.request
import tempfile
import websockets
from pathlib import Path

TARGET_URL = "http://127.0.0.1:3000/"

def start_chrome():
    tmp_profile = tempfile.mkdtemp(prefix="chrome_headless_test_")
    cmd = [
        "/usr/bin/google-chrome",
        "--headless=new",
        "--remote-debugging-port=9223",
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
            with urllib.request.urlopen("http://127.0.0.1:9223/json/list") as resp:
                targets = json.loads(resp.read().decode())
                for t in targets:
                    if t.get("type") == "page" and "127.0.0.1:3000" in t.get("url", ""):
                        return proc, t["webSocketDebuggerUrl"]
        except Exception:
            time.sleep(0.3)
    proc.terminate()
    raise RuntimeError("Could not find page target in Chrome")

async def run_suite():
    proc, ws_url = start_chrome()
    print("Connected to Headless Chrome:", ws_url)
    console_logs = []
    js_errors = []
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
                    if data.get("method") == "Runtime.consoleAPICalled":
                        log_type = data["params"]["type"]
                        args = [str(a.get("value", a.get("description", ""))) for a in data["params"]["args"]]
                        console_logs.append(f"[{log_type}] {' '.join(args)}")
                    elif data.get("method") == "Runtime.exceptionThrown":
                        js_errors.append(data["params"]["exceptionDetails"])
                    elif data.get("id") == my_id:
                        if "error" in data:
                            raise RuntimeError(data["error"])
                        return data.get("result", {})

            await call("Page.enable")
            await call("Runtime.enable")

            # Wait for hydration
            for _ in range(60):
                await asyncio.sleep(0.5)
                chk = await call("Runtime.evaluate", {
                    "expression": "!!document.querySelector('.hud-header') && !!document.querySelector('canvas')",
                    "returnByValue": True
                })
                if chk.get("result", {}).get("value") is True:
                    break
            await asyncio.sleep(2.0)
            print("Page hydrated. Running tests...")

            # Test A: Check initial console errors
            print("Initial console errors count:", len(js_errors))

            # Test B: Click Sedna Chip
            click_sedna = await call("Runtime.evaluate", {
                "expression": """
                (() => {
                    const chips = Array.from(document.querySelectorAll('.chip'));
                    const sednaChip = chips.find(c => c.innerText.includes('Sedna'));
                    if (sednaChip) {
                        sednaChip.click();
                        return { found: true, text: sednaChip.innerText };
                    }
                    return { found: false };
                })()
                """,
                "returnByValue": True
            })
            print("Click Sedna:", click_sedna.get("result", {}).get("value"))
            await asyncio.sleep(1.0)

            # Test C: Check Target Details for Sedna
            target_info = await call("Runtime.evaluate", {
                "expression": """
                (() => {
                    const name = document.querySelector('.target-name')?.innerText;
                    const cat = document.querySelector('.category-tag')?.innerText;
                    return { name, cat };
                })()
                """,
                "returnByValue": True
            })
            print("Target after Sedna click:", target_info.get("result", {}).get("value"))

            # Test D: Switch Blink Mode to Split Wipe and test slider
            click_split = await call("Runtime.evaluate", {
                "expression": """
                (() => {
                    const btns = Array.from(document.querySelectorAll('.toggle-pill'));
                    const splitBtn = btns.find(b => b.innerText.includes('Split Wipe'));
                    if (splitBtn) {
                        splitBtn.click();
                        return { clicked: true, text: splitBtn.innerText };
                    }
                    return { clicked: false };
                })()
                """,
                "returnByValue": True
            })
            print("Click Split Wipe:", click_split.get("result", {}).get("value"))
            await asyncio.sleep(0.5)

            split_check = await call("Runtime.evaluate", {
                "expression": """
                (() => {
                    const slider = document.querySelector('.cutout-frame input[type=\"range\"]');
                    const img1 = document.querySelector('.cutout-frame img[alt=\"Epoch 1\"]');
                    const img2 = document.querySelector('.cutout-frame img[alt=\"Epoch 2\"]');
                    return {
                        hasSlider: !!slider,
                        sliderVal: slider ? slider.value : null,
                        hasImg1: !!img1,
                        hasImg2: !!img2
                    };
                })()
                """,
                "returnByValue": True
            })
            print("Split Wipe check after render:", split_check.get("result", {}).get("value"))

            # Test E: Switch to Difference Mode |I2 - I1|
            click_diff = await call("Runtime.evaluate", {
                "expression": """
                (() => {
                    const btns = Array.from(document.querySelectorAll('.toggle-pill'));
                    const diffBtn = btns.find(b => b.innerText.includes('Difference'));
                    if (diffBtn) {
                        diffBtn.click();
                        return { clicked: true, text: diffBtn.innerText };
                    }
                    return { clicked: false };
                })()
                """,
                "returnByValue": True
            })
            print("Click Diff Mode:", click_diff.get("result", {}).get("value"))
            await asyncio.sleep(1.0)

            diff_check = await call("Runtime.evaluate", {
                "expression": """
                (() => {
                    const canvas = document.querySelector('.cutout-frame canvas');
                    return {
                        hasCanvas: !!canvas,
                        w: canvas ? canvas.width : 0,
                        h: canvas ? canvas.height : 0
                    };
                })()
                """,
                "returnByValue": True
            })
            print("Diff Mode check after render:", diff_check.get("result", {}).get("value"))

            # Test F: Guided Tour
            click_tour = await call("Runtime.evaluate", {
                "expression": """
                (() => {
                    const tourBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Guided Tour'));
                    if (tourBtn) {
                        tourBtn.click();
                        return { clicked: true, text: tourBtn.innerText };
                    }
                    return { clicked: false };
                })()
                """,
                "returnByValue": True
            })
            print("Click Guided Tour:", click_tour.get("result", {}).get("value"))
            await asyncio.sleep(0.5)

            tour_check = await call("Runtime.evaluate", {
                "expression": """
                (() => {
                    const banner = document.querySelector('.tour-banner');
                    return {
                        tourBannerMounted: !!banner,
                        title: banner ? banner.querySelector('strong')?.innerText : null
                    };
                })()
                """,
                "returnByValue": True
            })
            print("Tour check after render:", tour_check.get("result", {}).get("value"))
            await asyncio.sleep(0.5)

            # Test G: Tour progression (Step 1 -> 2 -> 3 -> 4)
            tour_progress = await call("Runtime.evaluate", {
                "expression": """
                (() => {
                    const nextBtn = Array.from(document.querySelectorAll('.tour-banner button')).find(b => b.innerText.includes('Next'));
                    if (nextBtn) nextBtn.click();
                    return { clickedNext: !!nextBtn };
                })()
                """,
                "returnByValue": True
            })
            print("Tour Next Step clicked:", tour_progress.get("result", {}).get("value"))
            await asyncio.sleep(0.5)

            tour_step2 = await call("Runtime.evaluate", {
                "expression": "document.querySelector('.tour-banner strong')?.innerText",
                "returnByValue": True
            })
            print("Tour Step 2 title:", tour_step2.get("result", {}).get("value"))

            # Close tour
            await call("Runtime.evaluate", {
                "expression": "document.querySelector('.tour-banner button')?.click()",
                "returnByValue": True
            })
            await asyncio.sleep(0.5)

            # Test H: Spitzer Space Telescope Modal
            click_spitzer = await call("Runtime.evaluate", {
                "expression": """
                (() => {
                    const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Spitzer Space Telescope Heritage'));
                    if (btn) {
                        btn.click();
                        return { clicked: true };
                    }
                    return { clicked: false };
                })()
                """,
                "returnByValue": True
            })
            print("Click Spitzer Modal:", click_spitzer.get("result", {}).get("value"))
            await asyncio.sleep(0.5)

            spitzer_check = await call("Runtime.evaluate", {
                "expression": """
                (() => {
                    const modal = document.querySelector('.modal-dialog');
                    const title = modal ? modal.querySelector('.modal-title')?.innerText : null;
                    const closeBtn = modal ? modal.querySelector('.btn-close') : null;
                    if (closeBtn) closeBtn.click();
                    return { hasModal: !!modal, title, closed: !!closeBtn };
                })()
                """,
                "returnByValue": True
            })
            print("Spitzer Modal check & close:", spitzer_check.get("result", {}).get("value"))
            await asyncio.sleep(0.5)

            # Test I: Astrometry Modal & Pixel Shift Slider
            click_astrometry = await call("Runtime.evaluate", {
                "expression": """
                (() => {
                    const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Astrometry'));
                    if (btn) {
                        btn.click();
                        return { clicked: true };
                    }
                    return { clicked: false };
                })()
                """,
                "returnByValue": True
            })
            print("Click Astrometry Modal:", click_astrometry.get("result", {}).get("value"))
            await asyncio.sleep(0.5)

            astrometry_slider = await call("Runtime.evaluate", {
                "expression": """
                (() => {
                    const modal = document.querySelector('.modal-dialog');
                    const slider = modal ? modal.querySelector('input[type=\"range\"]') : null;
                    if (!slider) return { hasSlider: false };
                    slider.value = 5.0;
                    slider.dispatchEvent(new Event('change', { bubbles: true }));
                    slider.dispatchEvent(new Event('input', { bubbles: true }));
                    const text = modal.innerText;
                    const closeBtn = modal.querySelector('.btn-close');
                    if (closeBtn) closeBtn.click();
                    return {
                        hasSlider: true,
                        includesAU: text.includes('AU'),
                        closed: !!closeBtn
                    };
                })()
                """,
                "returnByValue": True
            })
            print("Astrometry Calculator slider test:", astrometry_slider.get("result", {}).get("value"))
            await asyncio.sleep(0.5)

            # Test J: Click Live NASA Indicator Pill (Manual Sync Test)
            pill_click = await call("Runtime.evaluate", {
                "expression": """
                (() => {
                    const pill = document.querySelector('.live-indicator-pill');
                    if (pill) {
                        pill.click();
                        return { clicked: true, text: pill.innerText };
                    }
                    return { clicked: false };
                })()
                """,
                "returnByValue": True
            })
            print("Click Live Indicator Pill:", pill_click.get("result", {}).get("value"))
            await asyncio.sleep(2.0)

            # Test K: Timeline Scrubber Interaction
            scrubber_test = await call("Runtime.evaluate", {
                "expression": """
                (() => {
                    const scrubber = document.querySelector('.timeline-scrubber');
                    if (!scrubber) return { found: false };
                    const origVal = scrubber.value;
                    scrubber.value = String(Number(origVal) + 86400000 * 30);
                    scrubber.dispatchEvent(new Event('change', { bubbles: true }));
                    scrubber.dispatchEvent(new Event('input', { bubbles: true }));
                    return { found: true, origVal, newVal: scrubber.value };
                })()
                """,
                "returnByValue": True
            })
            print("Timeline scrubber test:", scrubber_test.get("result", {}).get("value"))
            await asyncio.sleep(0.5)

            # Test L: Scale Mode Toggle
            scale_test = await call("Runtime.evaluate", {
                "expression": """
                (() => {
                    const btns = Array.from(document.querySelectorAll('button'));
                    const scaleBtn = btns.find(b => b.innerText.includes('Scale'));
                    if (scaleBtn) {
                        scaleBtn.click();
                        return { clicked: true, text: scaleBtn.innerText };
                    }
                    return { clicked: false };
                })()
                """,
                "returnByValue": True
            })
            print("Scale mode toggle test:", scale_test.get("result", {}).get("value"))
            await asyncio.sleep(0.5)

            # Test M: Check for uncaught JS errors
            print("\nTotal JS Exceptions during session:", len(js_errors))
            for err in js_errors:
                print("JS Exception:", err.get("text"), err.get("exception", {}).get("description"))

            print("\nConsole logs recorded:", len(console_logs))
            for l in console_logs[-10:]:
                print("  ", l)

    finally:
        proc.terminate()
        proc.wait()

if __name__ == "__main__":
    asyncio.run(run_suite())
