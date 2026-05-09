#!/usr/bin/env python3
"""从 Chrome 提取小红书 (xiaohongshu.com) 的 cookie，输出为 JSON。"""

import json
import sys
import browser_cookie3


def get_cookies(domain: str = 'xiaohongshu.com') -> dict[str, str]:
    cj = browser_cookie3.chrome(domain_name=domain)
    return {c.name: c.value for c in cj if domain in c.domain}


def main():
    domain = sys.argv[1] if len(sys.argv) > 1 else 'xiaohongshu.com'
    cookies = get_cookies(domain)

    if not cookies:
        print(json.dumps({"error": f"未找到 {domain} 的 cookie，请先登录小红书"}, ensure_ascii=False))
        sys.exit(1)

    print(json.dumps(cookies, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
