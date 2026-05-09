# 小红书发现页图片下载器

自动从 [小红书发现页](https://www.xiaohongshu.com/explore) 抓取并下载图片。

## 原理

1. 通过 `browser_cookie3` 从 Chrome 提取已登录的小红书 cookie
2. 使用 Playwright 打开发现页，滚动加载更多内容
3. 提取页面所有图片 URL 并下载到本地

## 前置要求

- Python 3 + `browser_cookie3`（提取 Chrome cookie）
- Node.js 22+
- Chrome 浏览器（需已登录小红书）

## 安装

```bash
npm install
pip3 install browser-cookie3
```

## 使用

```bash
# 运行抓取（会自动打开浏览器窗口）
node scripts/e2e.mjs
```

图片保存到 `img/` 目录，截图保存到 `screenshots/` 目录。

## 配置

- 环境变量 `DOMAIN`：指定域名，默认 `xiaohongshu.com`
- `SCROLL_TIMES`：滚动加载次数（脚本内变量，默认 5）
