# 白嫖社区个人统计

独立的 Chromium Manifest V3 浏览器插件，用弹窗查看当前登录的白嫖社区账号资料、互动统计和最近活动。

## 本地安装

1. 打开 Edge 的 `edge://extensions/` 或 Chrome 的 `chrome://extensions/`。
2. 开启“开发人员模式”。
3. 点击“加载解压缩的扩展”。
4. 选择本目录 `baipiao-community-stats-extension`。
5. 先在 `https://baipiao.org/bbs/` 登录，再点击工具栏里的插件图标。

## 权限和隐私

- `storage`：只保存归一化后的非敏感统计快照和界面偏好。
- `tabs`：查找或打开白嫖社区标签页。
- `scripting`：在白嫖社区页面内协调数据读取。
- `https://baipiao.org/bbs/*`：仅允许访问社区页面。

插件不读取 `document.cookie`，不读取密码输入框，不保存或上传密码、Cookie、Authorization、Token、完整 HTML 或原始响应。插件只复用当前浏览器会话在社区页面内执行同源读取。

## 数据说明

站点接口或页面字段发生变化时，部分统计可能显示为 `—`。插件不会使用页面条目数猜测缺失统计，也不会执行发帖、点赞、收藏、私信等改变社区状态的操作。

## 开发检查

```powershell
npm test
npm run check
```
