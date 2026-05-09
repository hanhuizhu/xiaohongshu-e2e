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
const SCROLL_TIMES = 60;

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

  // 5. 拦截网络请求：收集所有帖子图片 URL
  const imageUrlSet = new Set();
  page.on('response', response => {
    const url = response.url();
    if (url.includes('sns-webpic') && url.includes('nc_n_webp')) {
      imageUrlSet.add(url);
    }
  });

  // 6. 打开发现页（explore）
  await page.goto(`https://www.${domain}/explore`, { waitUntil: 'networkidle', timeout: 30000 });
  console.log(`发现页 URL: ${page.url()}`);
  console.log(`首次加载收集到 ${imageUrlSet.size} 张帖子图片`);

  // 7. 缓慢滚动到底部，收集更多图片
  for (let i = 0; i < SCROLL_TIMES; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(3000);
    if ((i + 1) % 10 === 0) {
      console.log(`滚动第 ${i + 1}/${SCROLL_TIMES} 次，累计收集 ${imageUrlSet.size} 张图片`);
    }
  }

  // 截图诊断
  const screenshotPath = path.join(IMG_DIR, '..', 'screenshots', 'explore.png');
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`截图: ${screenshotPath}`);

  // 8. 转为数组并下载
  const postUrls = [...imageUrlSet];
  console.log(`共发现 ${postUrls.length} 张帖子图片`);
  if (postUrls.length > 0) {
    console.log('前 3 张:', postUrls.slice(0, 3));
  }

  let successCount = 0;
  for (let i = 0; i < postUrls.length; i++) {
    const url = postUrls[i];
    // 使用序号命名，去除 URL 参数作为扩展名参考
    const filePath = path.join(IMG_DIR, `${String(i + 1).padStart(3, '0')}.jpg`);
    try {
      await downloadImage(url, filePath);
      successCount++;
      console.log(`[${i + 1}/${postUrls.length}] 下载成功`);
    } catch (err) {
      console.log(`[${i + 1}/${postUrls.length}] 下载失败: ${url.slice(0, 60)}`);
    }
  }

  console.log(`\n完成！成功下载 ${successCount}/${postUrls.length} 张帖子图片到 img/ 目录`);

  await browser.close();
}

main().catch(err => {
  console.error('E2E 失败:', err);
  process.exit(1);
});
