# DSH 桌面通知（dsh-win-notify）

> 中文名：**DSH 桌面通知**　·　包名：`dsh-win-notify`　·　插件 id：`win-notify`

DSH 在后台干活时，人不一定盯着浏览器标签。这个插件把「需要你」的时刻推到 **Windows 通知**里：

| 场景 | 通知内容 | 你能在上面做什么 |
|---|---|---|
| **任务完成** | 模型这一轮的最终回答 | 直接在通知的输入框里回话，回车即送回会话 |
| **需要授权** | 哪个工具、要干什么、为什么 | 「允许一次 / 拒绝」 |
| **模型提问** | 问题与选项 | 点选项；没有选项时给输入框 |

**点通知正文（那块空白）→ 直接切回你已经开着的 DSH 页面**，不新开标签；确实没开着，才打开新页面。
**DSH 本来就活在前台时，干脆不弹**（默认开，插件页里可关）。
装好即用，DSH 侧不需要任何操作 —— 它挂在 `turn/end`、`approval/request`、`user-questions/request` 上。

---

## 点通知之后去哪儿

点正文时不会傻乎乎再开一个标签页，顺序是：

1. 枚举桌面上所有可见窗口，标题里含 `focusTitles` 里任一提示词（默认 `DeepSeek Harness`）→ 认定是 DSH 页面；
2. 最小化的先还原，然后抢到前台（`AttachThreadInput` + `SetForegroundWindow`，否则后台进程抢不到焦点）；
3. 一个都找不到（或抢不到）才用 `dshUrl` 打开新页面。

所以浏览器标题会变的场景（比如你改了会话标题）请在设置里补提示词：
`focusTitles` 是个字符串数组，加一条 `DSH` 之类的即可。

> 顺带解决了另一个坑：`dsh-notify://` 这个协议如果只写 `shell\open\command` 而不写
> `URL Protocol` 空值，Windows 会弹「没有可打开此链接的应用」。`register.ps1` 现在两样都写。

---

## 设置入口（不用改 YAML）

**设置 → 插件 → dsh-win-notify**，这个详情页里就有一块「提示音」：

- 三个下拉框：任务完成 / 需要授权 / 模型提问，各选各的；
- 选项 = 系统通知音 / 系统提醒音 / 静音 **+ `assets/sounds/` 下的每个 wav、mp3**；
- 下面的勾选框控制「DSH 在前台时不弹通知」。

这块界面是 `client.js` 注册到插件详情页插槽（`plugins.detail.section`）里的，
读写走 shell 的 `configForms` 服务（带 revision 校验），改完直接写回当前 profile。

换个音效：把文件丢进 `assets/sounds/`，**重启 DSH**，下拉框里就多一项。

> 系统限制：toast 的自定义音频只认 **wav / mp3**，且 **≤ 10 秒**；超时或格式不对，整条通知会被系统丢掉。

其余配置（`dshUrl`、`focusTitles`、`appName`、codex 风格的 `notify` 钩子）在插件页的通用配置表单里，
或直接编辑 `~\.dsh\profiles\web\cordis.patch.yml` 的 `win-notify` 段。

---

## 交互怎么绕回 DSH

非打包应用没有 COM activator，通知上的按钮点下去，系统只会「用注册的协议把一句话交回来」。
所以：

1. `assets/register.ps1`（每次启动跑一次，幂等）建开始菜单快捷方式、写 `AppUserModelID`、
   注册 `dsh-notify://` 协议 —— 没有快捷方式这一步，Win10/11 会**静默丢掉** toast，不报错；
2. 按钮的取值编进 URI：`dsh-notify://<port>/<secret>/<id>/option?v=allowed-once&u=<回DSH地址>`；
3. 输入框靠 `{reply}` 占位符；系统不替换它的版本，点「发送」会打开 DSH 页面而不是丢消息；
4. `assets/activate.ps1` 收到协议后 POST 回本进程的 `127.0.0.1` 回路（随机端口 + 一次性密钥）。

授权与提问的答案还要和浏览器里那张卡**竞速**：插件先 `next()` 让浏览器也拿到请求，
谁先给出有效答案算谁的；通知被关掉/超时不算答案，继续等浏览器。

---

## 安装

**给别人的安装说明**（Windows 10/11 + DSH 0.2.x）：

```powershell
# 1. 把这个包放进 DSH 的 profile（web profile 就是浏览器版用的那个）
dsh plugin add C:\path\to\dsh-win-notify-0.2.0.tgz --profile web
#    或者直接指目录（开发/本地副本）
#    dsh plugin add link:C:\path\to\dsh-win-notify --profile web

# 2. 让 profile 启用它：编辑 ~\.dsh\profiles\web\package.json
#    "dsh": { "profile": { "bundles": [ … , "dsh-win-notify" ] } }
#    （也可以在「设置 → 插件」里把它打开）

# 3. 重启 DSH
```

首次发通知时插件会自己跑一次 `assets/register.ps1`：建开始菜单快捷方式 `DSH 桌面通知.lnk`、
写 `AppUserModelID`、注册 `dsh-notify://` 协议 —— 这几步都在当前用户下（HKCU），不需要管理员。

**要求**：Windows 10/11、PowerShell 5.1（系统自带）、DSH 的 Web 版。
装完去「设置 → 系统 → 通知」确认 `DeepSeek Harness` 的通知是打开的。

**从本地目录安装**（自己改代码时用）：

```powershell
#   ~\.dsh\profiles\web\package.json
#     dependencies:  "dsh-win-notify": "link:<插件所在目录>"
#     dsh.profile.bundles: 追加 "dsh-win-notify"
#   ~\.dsh\profiles\web\node_modules\dsh-win-notify  → 软链到插件目录
# 依赖解析：插件目录里建 node_modules\@deepseek-ai → ~\.dsh\profiles\node_modules\@deepseek-ai
```

改完 **重启 DSH**（bundle 变更不走热重载）。

---

## 卸载

```powershell
# 1. 清系统侧留下的东西：开始菜单快捷方式、dsh-notify:// 协议、应用身份、通知开关
powershell -NoProfile -ExecutionPolicy Bypass -File assets\unregister.ps1

# 2. 从 profile 卸包，并从 bundles 里删掉 "dsh-win-notify"
dsh plugin remove dsh-win-notify --profile web

# 3. 重启 DSH
```

不碰 DSH 本体，也不碰你自己放进 `assets/sounds/` 的音频。

---

## 分发

`dist/` 里是两份同源产物：

| 文件 | 用途 |
|---|---|
| `dsh-win-notify-0.2.0.tgz` | 给 `dsh plugin add` 用（16 个文件，24.7 kB） |
| `dsh-win-notify-0.2.0.zip` | 解压即用，额外带 `scripts/`（19 个文件），方便对方自己跑冒烟 |
| `SHA256SUMS.txt` | 两份产物的 sha256 |

重新打包：

```powershell
npm pack --pack-destination dist          # 出 tgz
node scripts/smoke.mjs; node scripts/smoke-client.mjs   # 打之前先自检
```

> 打包产物里**不含** `node_modules`：`@deepseek-ai/*` 由对方的 DSH profile 提供（见 `peerDependencies`）。

---

## 验收

```powershell
cd <插件目录>
node scripts/smoke.mjs                     # 离线：Config 表单 + 监听器 + 伪造 turn/end
node scripts/demo.mjs turn-end             # 发一条完成通知
node scripts/demo.mjs approval             # 授权通知（允许一次 / 拒绝）
node scripts/demo.mjs question             # 提问通知（选项）
DEMO_SOUND=none node scripts/demo.mjs question   # 试静音
```

通知上的操作会以 `[callback] {"action":"option","value":"allowed-once"}` 打在终端上。
2026-10-23 实测：`ToastNotificationManager.History.GetHistory('DeepSeek.Harness')` 能取到发出的通知、
`ToastNotifier.Setting=Enabled`；本机横幅是否弹出还受系统「勿扰 / 横幅」开关影响，关掉即可见。

---

## 文件

| 文件 | 作用 |
|---|---|
| `index.js` | Host 入口：三个入口事件 + `Config`（设置表单的数据源） |
| `client.js` | 浏览器入口：在插件详情页注册「提示音」那块设置 |
| `lib/config.js` | Config Schema、音效发现与路径解析 |
| `lib/toast.js` | WinRT toast 组装、`dsh-notify://` URI、音频源 |
| `lib/ipc.js` | 本机回路：协议激活打回来的操作在这里落地 |
| `lib/text.js` | 把模型回答压成通知能读的纯文本 |
| `assets/toast.ps1` | 发通知的 WinRT 调用；DSH 在前台时直接不发 |
| `assets/dshwin.ps1` | 共用 Win32：找窗口 / 抢前台 / 读前台标题（C# 缓存成 dll） |
| `assets/focus.ps1` | 把已开着的 DSH 页面切到前台 |
| `assets/register.ps1` | 通知身份 + 协议注册（幂等） |
| `assets/activate.ps1` | 协议激活处理器 |
| `assets/sounds/` | 自定义提示音放这里 |

---

## 已知限制

- 一次问多个问题时只提醒不代答：答案必须一次给全，缺一个就是非法批次。
- 通知里的输入框依赖系统对 `{reply}` 的替换，部分版本不替换（此时点发送会打开 DSH）。
- 非 Windows 平台直接不挂载。
