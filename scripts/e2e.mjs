// @ts-check
import { chromium } from 'playwright';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import https from 'https';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMG_DIR = path.join(__dirname, '..', 'img');
const SCROLL_TIMES = 5; // 滚动次数

/** 调用 Python 脚本获取 cookie */
function getCookies(domain = 'xiaohongshu.com') {
  const script = path.join(__dirname, 'extract_cookies.py');
  const raw = execSync(`python3 "${script}" "${domain}"`, { encoding: 'utf-8' });
  return JSON.parse(raw);
}

/** 将 Python cookie dict 转为 Playwright cookie 格式 */
function toPlaywrightCookies(cookies, domain) {
  return Object.entries(cookies).map(([name, value]) => ({
    name,
    value,
    domain: `.${domain}`,
    path: '/',
    httpOnly: false,
    secure: true,
    sameSite: 'Lax',
  }));
}

/** 下载图片 */
function downloadImage(url, filePath) {
  return new Promise((resolve, reject) => {
    const transport = url.startsWith('https') ? https : http;
    transport.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadImage(res.headers.location, filePath).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const ext = res.headers['content-type']?.split('/')[1] || 'jpg';
      const finalPath = filePath.includes('.') ? filePath : `${filePath}.${ext}`;
      const file = fs.createWriteStream(finalPath);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  const domain = process.env.DOMAIN || 'xiaohongshu.com';

  // 1. 提取 cookie
  console.log(`正在提取 ${domain} 的 cookie...`);
  const rawCookies = getCookies(domain);
  if (rawCookies.error) {
    console.error(`失败: ${rawCookies.error}`);
    process.exit(1);
  }
  console.log(`成功提取 ${Object.keys(rawCookies).length} 个 cookie`);

  // 2. 创建 img 目录
  fs.mkdirSync(IMG_DIR, { recursive: true });

  // 3. 启动浏览器
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });

  // 4. 注入 cookie
  const pwCookies = toPlaywrightCookies(rawCookies, domain);
  await context.addCookies(pwCookies);

  const page = await context.newPage();

  // 5. 先打开 explore 页面，找用户信息
  await page.goto(`https://www.${domain}/explore`, { waitUntil: 'networkidle', timeout: 30000 });
  console.log(`探索页 URL: ${page.url()}`);

  // 从页面中找当前登录用户的 profile 链接
  const profileLink = await page.evaluate(() => {
    // 找包含用户名的链接
    const links = document.querySelectorAll('a[href*="/user/profile"]');
    for (const a of links) {
      const href = a.getAttribute('href');
      if (href && !href.endsWith('/user/profile')) return href;
    }
    // 或者找个人中心入口
    const sideLinks = document.querySelectorAll('a[href*="profile"], a[href*="user"]');
    for (const a of sideLinks) {
      const href = a.getAttribute('href');
      if (href) return href;
    }
    return null;
  });

  if (profileLink) {
    const profileUrl = profileLink.startsWith('http') ? profileLink : `https://www.${domain}${profileLink}`;
    console.log(`找到个人中心: ${profileUrl}`);
    await page.goto(profileUrl, { waitUntil: 'networkidle', timeout: 30000 });
    console.log(`个人中心 URL: ${page.url()}`);
  } else {
    console.log('未找到个人中心链接，在 explore 页面继续');
  }

  // 6. 滚动页面，触发懒加载
  for (let i = 0; i < SCROLL_TIMES; i++) {
    await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight / 3));
    await page.waitForTimeout(2000);
    console.log(`滚动第 ${i + 1}/${SCROLL_TIMES} 次`);
  }

  // 截图诊断
  const screenshotPath = path.join(IMG_DIR, '..', 'screenshots', 'profile.png');
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`截图: ${screenshotPath}`);

  // 7. 提取图片 - 多种方式
  const imageUrls = await page.evaluate(() => {
    const urls = new Set();

    // 方式1: img 标签
    document.querySelectorAll('img').forEach(el => {
      const src = el.currentSrc || el.src || el.getAttribute('data-src') || '';
      if (src && !src.startsWith('data:') && !src.includes('data:image')) {
        urls.add(src);
      }
    });

    // 方式2: 背景图片
    document.querySelectorAll('*').forEach(el => {
      const bg = window.getComputedStyle(el).backgroundImage;
      if (bg && bg !== 'none') {
        const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
        if (m && m[1] && !m[1].startsWith('data:')) urls.add(m[1]);
      }
    });

    // 方式3: picture source
    document.querySelectorAll('source').forEach(el => {
      const src = el.getAttribute('srcset') || el.getAttribute('data-srcset') || '';
      if (src) {
        src.split(',').forEach(s => {
          const url = s.trim().split(/\s+/)[0];
          if (url && !url.startsWith('data:')) urls.add(url);
        });
      }
    });

    return [...urls];
  });

  console.log(`共发现 ${imageUrls.length} 张图片`);
  if (imageUrls.length > 0) {
    console.log('前 5 张:', imageUrls.slice(0, 5));
  }

  // 8. 下载图片
  let successCount = 0;
  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i];
    const ext = path.extname(new URL(url).pathname) || '.jpg';
    const filePath = path.join(IMG_DIR, `${String(i + 1).padStart(3, '0')}${ext}`);
    try {
      await downloadImage(url, filePath);
      successCount++;
      console.log(`[${i + 1}/${imageUrls.length}] 下载成功`);
    } catch (err) {
      console.log(`[${i + 1}/${imageUrls.length}] 下载失败: ${url.slice(0, 60)}`);
    }
  }

  console.log(`\n完成！成功下载 ${successCount}/${imageUrls.length} 张图片到 img/ 目录`);

  await browser.close();
}

main().catch(err => {
  console.error('E2E 失败:', err);
  process.exit(1);
});
