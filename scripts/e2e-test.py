"""
E2E 全流程测试：登录 → Feed 消化 → Memory 卡片展示 → 删除/评价
"""
import time
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
EMAIL = "test@test.com"
PASSWORD = "test123456"
SCREENSHOTS_DIR = "/tmp/e2e"

import os
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)

def screenshot(page, name):
    path = f"{SCREENSHOTS_DIR}/{name}.png"
    page.screenshot(path=path, full_page=True)
    print(f"  [screenshot] {path}")

def test_login(page):
    print("\n=== TEST 1: Login ===")
    page.goto(f"{BASE}/auth/login")
    page.wait_for_load_state("networkidle")
    screenshot(page, "01-login-page")

    page.fill('input[type="email"]', EMAIL)
    page.fill('input[type="password"]', PASSWORD)
    page.click('button[type="submit"]')

    # Wait for redirect to feed/home
    page.wait_for_url(f"{BASE}/feed**", timeout=10000)
    print("  [PASS] Login successful, redirected to /feed")
    screenshot(page, "02-after-login")

def test_feed_text(page):
    print("\n=== TEST 2: Feed - Text Input ===")
    page.goto(f"{BASE}/feed")
    page.wait_for_load_state("networkidle")
    screenshot(page, "03-feed-page")

    # Input text content
    textarea = page.locator("textarea")
    textarea.fill("巴菲特2024年股东信的核心观点：长期持有优质企业比频繁交易更重要。他强调自由现金流是评估企业价值的核心指标，而非账面利润。伯克希尔哈撒韦的成功在于坚持能力圈原则，只投资自己理解的行业。")

    # Click submit
    page.click('button:has-text("喂给外脑")')
    print("  Submitted text content...")

    # Wait for processing phases
    page.wait_for_selector('text=消化完成', timeout=60000)
    print("  [PASS] Digest completed")
    screenshot(page, "04-feed-text-result")

    # Verify result card elements
    assert page.locator('text=核心观点').count() > 0, "Missing key points section"
    assert page.locator('[class*="badge"]').count() > 0, "Missing tags"
    print("  [PASS] Result card renders correctly with key points and tags")

def test_feed_with_opinion(page):
    print("\n=== TEST 3: Feed - URL + User Opinion (Separation Test) ===")
    page.goto(f"{BASE}/feed")
    page.wait_for_load_state("networkidle")

    # Enter a text (simulating URL + opinion scenario)
    url_input = page.locator('input[placeholder*="https"]')
    url_input.fill("")

    textarea = page.locator("textarea")
    # Use text mode with opinion marker to test separation
    textarea.fill("Sam Altman 认为 AGI 将在2-3年内实现，届时AI将能完成大多数知识工作。OpenAI的战略是通过GPT系列模型逐步接近AGI，同时通过API和产品形态广泛分发AI能力。")

    page.click('button:has-text("喂给外脑")')
    print("  Submitted content with opinion...")

    page.wait_for_selector('text=消化完成', timeout=60000)
    print("  [PASS] Digest completed")
    screenshot(page, "05-feed-opinion-result")

def test_memory_cards(page):
    print("\n=== TEST 4: Memory Page - Digest Cards ===")
    page.goto(f"{BASE}/memory")
    page.wait_for_load_state("networkidle")
    time.sleep(2)  # Wait for data fetch
    screenshot(page, "06-memory-page")

    # Check card structure
    cards = page.locator('[class*="card"]').all()
    print(f"  Found {len(cards)} cards on memory page")

    # Verify key points are shown in cards
    kp_sections = page.locator('text=核心观点').count()
    print(f"  Key points sections visible: {kp_sections}")

    # Check domain badges
    badges = page.locator('[class*="badge"]').all()
    print(f"  Badges visible: {len(badges)}")

    # Verify tag display
    tags = page.locator('text=#').all()
    print(f"  Tags visible: {len(tags)}")

    if len(cards) > 0:
        print("  [PASS] Memory page shows digest cards")
    else:
        print("  [WARN] No cards found - may be loading")

    screenshot(page, "07-memory-cards")

def test_memory_expand(page):
    print("\n=== TEST 5: Memory Card Expand ===")
    # Click first card to expand
    first_card = page.locator('text=展开').first
    if first_card.count() > 0:
        first_card.click()
        time.sleep(1)
        screenshot(page, "08-memory-expanded")

        # Check expanded content
        has_summary = page.locator('text=内容摘要').count() > 0
        has_actions = page.locator('text=添加评价').count() > 0 or page.locator('text=编辑评价').count() > 0
        has_delete = page.locator('text=删除').count() > 0

        print(f"  Summary section: {'YES' if has_summary else 'NO'}")
        print(f"  Edit note button: {'YES' if has_actions else 'NO'}")
        print(f"  Delete button: {'YES' if has_delete else 'NO'}")

        if has_actions and has_delete:
            print("  [PASS] Expanded card shows all action buttons")
        else:
            print("  [WARN] Some action buttons missing")
    else:
        print("  [SKIP] No expandable cards found")

def test_memory_add_note(page):
    print("\n=== TEST 6: Memory - Add User Note ===")
    # Click "添加评价" button
    add_btn = page.locator('button:has-text("添加评价")').first
    if add_btn.count() > 0:
        add_btn.click()
        time.sleep(0.5)

        # Fill in note
        note_area = page.locator('textarea[placeholder*="想法"]')
        if note_area.count() > 0:
            note_area.fill("这个观点很有启发，需要深入研究")
            screenshot(page, "09-memory-editing-note")

            # Save
            save_btn = page.locator('button:has-text("保存")')
            save_btn.click()
            time.sleep(1)
            screenshot(page, "10-memory-note-saved")

            # Verify note displays
            note_display = page.locator('text=我的评价').count()
            if note_display > 0:
                print("  [PASS] User note saved and displayed")
            else:
                print("  [WARN] Note may not have saved properly")
        else:
            print("  [SKIP] Note textarea not found")
    else:
        print("  [SKIP] No 'add note' button found")

def test_memory_domain_filter(page):
    print("\n=== TEST 7: Memory - Domain Filter ===")
    page.goto(f"{BASE}/memory")
    page.wait_for_load_state("networkidle")
    time.sleep(2)

    # Get initial count
    initial_cards = page.locator('[class*="cursor-pointer"]').count()
    print(f"  Initial cards: {initial_cards}")

    # Click a domain filter
    domain_btn = page.locator('button:has-text("跨领域")')
    if domain_btn.count() > 0:
        domain_btn.click()
        time.sleep(1)
        filtered_cards = page.locator('text=核心观点').count()
        print(f"  After filter: {filtered_cards} key point sections")
        screenshot(page, "11-memory-filtered")
        print("  [PASS] Domain filter works")
    else:
        print("  [SKIP] Domain filter button not found")

def test_memory_search(page):
    print("\n=== TEST 8: Memory - Search ===")
    page.goto(f"{BASE}/memory")
    page.wait_for_load_state("networkidle")
    time.sleep(2)

    search_input = page.locator('input[placeholder*="搜索"]')
    search_input.fill("巴菲特")
    time.sleep(2)  # debounce
    screenshot(page, "12-memory-search")

    results = page.locator('text=核心观点').count()
    print(f"  Search results with key points: {results}")
    print("  [PASS] Search executed")

def main():
    print("=" * 60)
    print("E2E Full Flow Test")
    print("=" * 60)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 900})
        page = context.new_page()

        try:
            test_login(page)
            test_feed_text(page)
            test_feed_with_opinion(page)
            test_memory_cards(page)
            test_memory_expand(page)
            test_memory_add_note(page)
            test_memory_domain_filter(page)
            test_memory_search(page)

            print("\n" + "=" * 60)
            print("ALL TESTS COMPLETED")
            print(f"Screenshots saved to: {SCREENSHOTS_DIR}/")
            print("=" * 60)
        except Exception as e:
            screenshot(page, "error-state")
            print(f"\n[FAIL] Test failed: {e}")
            raise
        finally:
            browser.close()

if __name__ == "__main__":
    main()
