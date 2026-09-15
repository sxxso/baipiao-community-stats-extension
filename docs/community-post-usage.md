# 分享一个白嫖社区个人统计插件：余额、等级、活动和资金记录一眼查看

最近做了一个白嫖社区个人统计插件，主要是方便查看一些分散在个人主页和资金记录页里的信息。插件目前支持 Chrome 和 Edge，源码和安装包都放在 GitHub，大家可以按自己的浏览器选择。

## 能看什么

点击浏览器工具栏里的插件图标，可以查看：

- 当前登录账号的用户名、头像、称号和加入时间
- 主题数、回复数、毛余额和社区等级
- 最近 7 天活跃趋势
- 最近主题和回复活动

在白嫖社区页面右下角，还会有一个可以收起的小窗口，用来显示：

- 最近 5 条资金记录
- 每条记录的资金用途和时间
- 余额是增加还是扣除，以及变化金额
- 当前毛余额

浮窗可以点击 `−` 收起，收起后点击 `+` 重新展开；点击 `↻` 可以手动刷新，点击“查看全部”可以打开网站原始资金记录页。

## 重要说明

现在打开插件弹窗时只读取浏览器本地缓存，不会自动刷新。需要读取最新数据时，点击弹窗右上角的刷新按钮即可。

资金记录和最近活动都是通过白嫖社区的接口直接读取的，在任何社区页面点刷新都能获取，不需要先打开个人主页或资金记录页，也不需要等待页面额外加载。毛余额刷新时优先读取 `/bbs/api/users/<用户ID>` 的 `money` 字段；资金流水接口只提供交易行，管理员调账等没有流水的变化也会正确反映。用户接口暂时不可用时，会回退到页面内嵌的余额；整个刷新请求失败时才保留上次成功缓存。

## 安装方法

GitHub 仓库：

https://github.com/sxxso/baipiao-community-stats-extension

直接下载：

- Edge：<https://github.com/sxxso/baipiao-community-stats-extension/releases/latest/download/baipiao-community-stats-extension-edge.zip>
- Chrome：<https://github.com/sxxso/baipiao-community-stats-extension/releases/latest/download/baipiao-community-stats-extension-chrome.zip>

下载对应压缩包后解压：

1. 打开 Edge 的 `edge://extensions/`，或 Chrome 的 `chrome://extensions/`。
2. 开启“开发人员模式”或“开发者模式”。
3. 点击“加载解压缩的扩展”或“加载已解压的扩展程序”。
4. 选择解压后第一层直接包含 `manifest.json` 的目录。
5. 打开白嫖社区并登录，然后刷新网页。

Edge 如果提示找不到清单文件，通常是目录选错了。不要选择 ZIP 文件或外层下载目录，继续进入内层，直到能直接看到 `manifest.json`。

## 安全性

插件只在 `https://baipiao.org/bbs/` 范围内读取当前登录账号已经可以看到的资料，不执行发帖、回复、点赞、收藏、私信、转账等操作。

插件不读取 `document.cookie`、密码输入框或网站 `localStorage`，不保存和上传密码、Cookie、Authorization、Token、完整 HTML 或原始响应。归一化后的统计快照和最多 5 条资金记录只保存在当前浏览器本地，不会上传到作者服务器。

安装前建议检查扩展的 `manifest.json`，确认权限只有 `storage`、`tabs`、`scripting`，网站范围只有 `https://baipiao.org/bbs/*`。源码公开在 GitHub，大家可以自行审查。

## 遇到问题

白嫖社区响应较慢时，插件会保留上次成功读取的数据。可以先刷新社区页面，等待加载完成，再点击插件右上角的刷新按钮。

如果资金记录为空，可以点击浮窗里的“查看全部”，确认网站原始资金记录页是否有数据。网站改版后如果页面结构变化，也可能需要更新解析规则。

欢迎试用。如果发现数据不对、读取超时或 Edge/Chrome 安装问题，可以在帖子下面反馈浏览器、页面位置和具体提示，尽量不要贴出账号 Cookie、密码或 Token。
