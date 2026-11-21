# dsh-speak

把 **speak 服务（TTS）** 注册成 DSH 原生工具 `say`：一段文本进去，一个 WAV 文件路径
出来。零运行时依赖，只发 HTTP + 写文件。

> Native DSH tool for text-to-speech. `say` synthesizes a WAV file and returns its path.

## 它做什么

模型调用 `say({ text, voice })` 时，插件：

1. `POST {baseUrl}/v1/speak`，body 是 `{ text, voice? }`；
2. 拿到 `audio/wav` 原始字节（**不是** JSON）；
3. 写到 `outDir`，文件名用 uuid，永远返回绝对路径；
4. 返回 `{ ok, path, bytes, ms, voice }`。

```jsonc
{ "ok": true,
  "path": "C:\\Users\\you\\AppData\\Local\\Temp\\dsh-speak\\5f0c….wav",
  "bytes": 264192, "ms": 1030, "voice": "huayan" }
```

为什么落盘而不是直接回传音频：DSH 工具的输出是文本/JSON，二进制塞不进去。文件路径
既能被宿主界面播放，也能被模型继续交给别的工具（转写、剪辑、发出去）。

### 可选：通知宿主自动播放

设置环境变量 `DSH_ACTION_URL` 后，插件会在写盘成功后再发一个请求：

```jsonc
POST {DSH_ACTION_URL}
{ "type": "speak", "path": "…wav 绝对路径", "text": "原始文本" }
```

没有这个变量、或者宿主没响应，**都会安静跳过**，`say` 依然成功——这个插件必须能脱离
任何宿主单独工作。通知失败不会写进返回值（避免模型被无关信息干扰）。

## 依赖

一个在跑的 speak 服务，满足：

- 默认地址 `http://127.0.0.1:8770`；
- `POST /v1/speak` 接受 `{ text, voice? }`，成功时响应 `content-type: audio/wav` 的原始字节；
- 失败时可以回非 `audio/*`（通常是 `200` + `{ "ok": false, "error": "..." }`），插件会把它
  当成错误而不是写一个坏文件。

开箱即用：DSH-MultiTool 的 `speak` 模块（Windows 下 `speak\start-server.cmd`，
基于 Piper / Windows SAPI，离线、免 key）。任何行为兼容的 TTS 服务都可以接。

## 安装

插件是标准 DSH bundle：`package.json` 里声明了 `dsh.bundle.patch`，装载时插入
`cordis.patch.yml` 那一行。

### 方式 A：Plugin Manager（推荐）

在 DSH 的 Plugin Manager 里安装 `dsh-speak`，或让 agent 调用 `plugin_manager` 的
`install_bundle`。

### 方式 B：手工放进 profile 的 `node_modules`

```powershell
# 1) 把仓库放进 profile 的 node_modules（路径换成你自己的 profile）
$dst = "$env:USERPROFILE\.dsh\profiles\default\node_modules\dsh-speak"
robocopy . $dst /MIR

# 2) 在 profile/package.json 的 dsh.profile.bundles 里加上包名
#    "dsh": { "profile": { "bundles": ["dsh-speak"] } }
```

npm 发布之后也可以直接在 profile 目录里 `npm i dsh-speak`。

### 方式 C：直接写进 `cordis.yml`

profile 的 `cordis.yml` 是一个插件条目列表。原文件如果是空的 `[]`，整个换成：

```yaml
- id: dsh-speak
  name: dsh-speak
  config:
    baseUrl: 'http://127.0.0.1:8770'
    outDir: 'C:\Users\you\AppData\Local\Temp\dsh-speak'
```

已有条目就追加一项：

```yaml
- id: dsh-speak
  name: dsh-speak
  config:
    baseUrl: 'http://127.0.0.1:8770'
    outDir: 'C:\Users\you\AppData\Local\Temp\dsh-speak'
```

`outDir` 可以省略，省略时用系统临时目录。Windows 路径里有反斜杠，YAML 里用单引号
包住最省事。

## 配置

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:8770` | speak 服务根地址，不要带结尾斜杠（带了会被去掉） |
| `outDir` | `os.tmpdir()/dsh-speak` | WAV 落盘目录，不存在会自动 `mkdir -p`；相对路径按进程 cwd 解析 |

| 环境变量 | 作用 |
| --- | --- |
| `DSH_SPEAK_URL` | `baseUrl` 的兜底值；配置里没写时才用它 |
| `DSH_ACTION_URL` | 可选的宿主动作端点，写盘成功后 POST `{type:"speak", path, text}`；不设置就跳过 |

解析优先级：`config.baseUrl` → `DSH_SPEAK_URL` → `http://127.0.0.1:8770`。

## 工具与参数 schema

### `say`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["text"],
  "properties": {
    "text": { "type": "string", "description": "Text to speak. Keep it short: one or two sentences." },
    "voice": { "type": "string", "description": "Optional voice id, e.g. yaoyao / huayan / huihui / kangkang" }
  }
}
```

常用音色（由服务端决定；不认识的值通常回落到服务端默认音色，具体看服务实现）：

| voice | 说明 | 前提 |
| --- | --- | --- |
| `huayan` | Piper 中文女声，音质最好 | 服务端装了 Piper，否则 `TTS_FAILED` |
| `yaoyao` | WinRT 年轻女声，最快 | Windows 自带 |
| `huihui` | WinRT 老式播音腔 | Windows 自带 |
| `kangkang` | WinRT 男声 | Windows 自带 |

服务端的 `/v1/health` 会回 `piper: true/false`；`piper:false` 时就别用 `huayan`。
插件不猜，`voice` 原样透传，失败会以 `TTS_FAILED` + 服务端 `error` 返回。

超时 90 秒（首次加载模型、长句都在这个预算内）。超过就返回 `code: "TIMEOUT"`。

### 返回值与错误码

成功：`{ ok: true, path, bytes, ms, voice }`，`ms` 是「发请求 → 写完文件」的端到端耗时。

失败一律是 `{ ok: false, code, ... }`，不抛异常：

| code | 含义 | 怎么处理 |
| --- | --- | --- |
| `EMPTY_TEXT` | `text` 为空或全是空白 | 不调用 TTS 直接拒绝，检查参数 |
| `UNREACHABLE` | 连不上 `baseUrl` | 服务没启动 / 端口不对 |
| `TIMEOUT` | 90 秒没拿到音频 | 服务卡住，或文本太长 |
| `TTS_FAILED` | 服务回了 JSON 错误（`200` + `{ok:false,error}`） | 看 `error` 字段，多半是音色名/引擎问题 |
| `EMPTY_AUDIO` | 响应是 `audio/*` 但不足 44 字节 | 服务端合成出了空 wav |
| `HTTP_<status>` | 服务返回 4xx/5xx 且不是音频 | 看 `detail` |

## 排错

### 1. 文件没生成，返回 `UNREACHABLE`

```powershell
node -e "fetch('http://127.0.0.1:8770/v1/health').then(r=>r.text()).then(console.log)"
```

`/v1/health` 回 `{ok:true,provider,voice,...}` 说明服务活着，问题在 `baseUrl`；
连不上就把 speak 服务启动起来，并确认端口没被别的程序占用。

### 2. 返回 `TTS_FAILED`，但服务是通的

speak 模块在合成失败时仍回 **HTTP 200**，只是 `content-type` 变成 JSON ——
这正是插件要检查 content-type 而不是只看状态码的原因。`error` 字段会告诉你原因，
常见的是音色名写错、Piper 可执行文件路径不对（服务端 `config.json` 里配）。

### 3. 文件写不出来（`EACCES` / `ENOENT`）

`outDir` 指向了没有写权限的目录（比如 `C:\Program Files\...`），或者路径里带非法字符。
换到用户目录/临时目录即可；目录不存在会自动创建，但父目录不可写时无能为力。

### 4. 宿主界面不自动播放

- 确认 DSH 进程里真的有 `DSH_ACTION_URL`（不是别的终端）；
- 确认接收端接受 `{type:"speak", path, text}` 这种 body；
- `path` 是**服务端本机**的绝对路径。如果 DSH 跑在容器/远程机器上、界面在另一台机器，
  界面读不到这个文件 —— 这是设计边界，不是 bug。

### 5. 临时目录越攒越多

默认落在 `os.tmpdir()/dsh-speak/`，插件**不负责清理**（文件可能还要被播放或转写）。
需要自动清理就把 `outDir` 指到一个你会定期清理的目录，或用系统临时目录清理策略。

### 6. 声音很机械 / 没有情感

这是当前引擎（Windows SAPI / Piper）的限制，不是插件参数问题。换音色只能改质感，
改不了语气。

## 开发

```powershell
node --check index.js
```

没有测试依赖、没有构建步骤；改完重载插件即可。

## License

MIT © 2026 lingbaojun233
