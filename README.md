# dsh-speak — 让 DSH 用自己的声音说话（BreezeBlue 云端 TTS）

DSH 平时只回文字，想听它说话得自己复制粘贴去别的工具。装上这个插件，模型能把要说的话合成一段 WAV，用当前人设的音色念出来，音色在不同会话里保持一致。

**默认只走 BreezeBlue 云端**：云端拿不到声音就明确报 503，不会偷偷换成本地音色——所以你不会听到一句「不知道是谁」的替代音。

> 这个仓库只是**客户端**。真正发声的是 speak 服务（默认 `127.0.0.1:8770`），它在 [DSH-MultiTool](https://github.com/lingbaojun233/DSH-MultiTool) 的 `speak/` 里，需要 BreezeBlue 的 key。

## 快速开始

### 1. 安装

```powershell
# 进入你的 DSH profile 目录（默认在 C:\Users\你\.dsh\profiles\desktop）
cd "$env:USERPROFILE\.dsh\profiles\desktop"   # 把 desktop 换成你的 profile 名

npm install https://github.com/lingbaojun233/dsh-speak/archive/refs/heads/main.tar.gz
```

约 2 秒装完，没有构建步骤、没有 npm 依赖。

### 2. 启用

`dependencies` 由 npm 自动写好，你只要把包名加进 `dsh.profile.bundles` 末尾：

```json
{
  "dependencies": {
    "dsh-speak": "https://github.com/lingbaojun233/dsh-speak/archive/refs/heads/main.tar.gz"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-headless",
        "dsh-speak"
      ]
    }
  }
}
```

> 保留你原有的其它 bundle 条目，只在最后追加。改完重启 DSH；headless 每次运行自动重新装配。

### 3. 验证

先看服务是否就绪（`keyPresent` 必须是 `true`）：

```powershell
curl.exe -s http://127.0.0.1:8770/v1/health
# {"ok":true,"provider":"breezeblue","strict":true,...,"breezeblue":{"keyPresent":true,...}}

curl.exe -s http://127.0.0.1:8770/v1/voice
# {"ok":true,"voiceId":"voc_...","name":"大肥鱼（迷糊版）","reason":"...","source":"persona"}
```

新开一个会话，对 DSH 说：

> 用 `say` 念一句：「大肥鱼语音插件安装成功。」**voice 传空字符串**，不要指定 yaoyao 或 huayan。

成功时 `say` 返回类似：

```json
{
  "ok": true,
  "path": "C:\\Users\\你\\AppData\\Local\\Temp\\dsh-speak\\7504c5e3-….wav",
  "bytes": 115444,
  "ms": 4497,
  "voice": "voc_8yud7hz7c9q2"
}
```

`bytes` 大于 44（WAV 头长度）、文件以 `RIFF` 开头、播放出来是人设音色，就算成功。
返回的 `voice` 是**机器可读 id**（`voc_…`）；中文名用 `GET /v1/voice` 看。

> 实测（`fish-server`，11 个汉字）：BreezeBlue 合成 `ms=4497`（约 4.5 秒），115444 字节，`provider=breezeblue`、`voice=大肥鱼（迷糊版）`，账本结算 2.2 credits。

## 它提供哪些工具

| 工具 | 干什么 | 例子 |
|---|---|---|
| `say` | 把文本合成为本地 WAV，返回绝对路径、字节数、耗时和音色 | 对 DSH 说「用 say 把这句话念出来：今天先到这里」 |

`say` 只有两个参数：

| 参数 | 必填 | 说明 |
|---|---|---|
| `text` | 是 | 要念的文字。服务端会清掉 Markdown/emoji，超过 300 字截断 |
| `voice` | 否 | **留空 = 跟人设**（推荐）。也可传 `voc_xxx` 指定云端音色 |

插件本身不解析音色，`voice` 原样透传给 speak 服务。合法值和行为以服务为准：

| `voice` | 结果 |
|---|---|
| 省略 / `""` / `auto` / `persona` | 按人设选音色（云端） |
| `breezeblue` / `cloud` | 云端默认音色 |
| `voc_xxxxxxxx` | 指定 BreezeBlue 音色 |
| `huayan` / `yaoyao` / `huihui` / `kangkang` | **显式点名本地引擎**（不是默认路径） |
| 其它乱写的值 | strict 模式下 400 `UNKNOWN_VOICE`，不会被替换成别的嗓子 |

## 依赖

| 依赖 | 说明 |
|---|---|
| speak 服务 | 默认 `http://127.0.0.1:8770`，`GET /v1/health` 返回 `ok:true` |
| BreezeBlue API key | 从 <https://breezeblue.ai/app/developer/api-keys> 申请，保存成**一行纯文本**：`secrets/breezeblue.key`（路径由服务端 `config.json` 的 `breezeblue.keyPath` 指定，默认 `C:\Apps\DSH-MultiTool\secrets\breezeblue.key`）。服务每次合成前现读，换 key 不用重启 |
| ffmpeg | 云端回的是 mp3，服务要转成 wav；路径在 `breezeblue.ffmpegExe` |
| 记忆服务（可选） | 音色由人设决定，服务会读 `http://127.0.0.1:8767/v1/persona`；人设服务挂了会沿用上次缓存 |
| Node.js | ≥ 18（DSH 自带） |

服务从 DSH-MultiTool 里起：

```powershell
cd C:\Apps\DSH-MultiTool\speak
node server.js
# 或双击 start-server.cmd
```

> 服务端 `config.json` 里的 key 路径、ffmpeg 路径默认按 `C:\Apps\DSH-MultiTool\` 布局写死；装在别处就改成你自己的路径。改完重开服务，`/v1/health` 里的 `keyPresent` / `ffmpeg` 会告诉你有没有生效。

**计费**：BreezeBlue 按字符计费，实测约 **0.185 credits/字**（22 字 ≈ 4.2）。Starter 套餐按官方标价约 **$3 = 10000 credits**（以官网为准），一句 20 字大约 4 credits。查账：

```powershell
curl.exe -s http://127.0.0.1:8770/v1/balance
curl.exe -s "http://127.0.0.1:8770/v1/usage?refresh=1"
```

**并发上限是 1**（Starter 档实测：同时发 4 句，1 成功、3 个 429）。所以服务内部有一条串行队列，插件不用自己排队；但也不要让模型一次并发合成很多句——第 N 句会等前面说完，一集 8 句大约 30~60 秒。

服务端还提供这些接口，排查时很有用：

```text
GET  /v1/health              状态、key 是否存在、队列深度、余额
GET  /v1/voice               当前人设音色 + 为什么选它
GET  /v1/voice?force=1       按人设强制重算
POST /v1/voice {voiceId}     人工钉住音色
GET  /v1/voices?zh=1         中文音色清单（9 个，带打分维度）
GET  /v1/usage               本进程累计 calls/chars/credits
GET  /v1/balance             账户余额（30 秒缓存）
POST /v1/speak {text,voice?} 返回 audio/wav 字节
```

## 配置

插件没有 `config.json`，配置是**插件行的 `config` 字段**（包自带 `cordis.patch.yml` 的默认值）：

| 字段 | 默认值 | 说明 |
|---|---|---|
| `baseUrl` | `http://127.0.0.1:8770` | speak 服务根地址；结尾斜杠会被去掉 |
| `outDir` | `os.tmpdir()/dsh-speak` | WAV 落盘目录，不存在会自动创建；相对路径按进程 cwd 解析 |

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `DSH_SPEAK_URL` | — | `baseUrl` 的兜底，配置里没写时才用 |
| `DSH_ACTION_URL` | 未设置 | 宿主接收端。设了就在写盘成功后 POST 一个 `{type:"speak", path, text, sessionId?}` 动作，界面可自动播放；送不到**静默跳过**，不影响 `say` 成功 |

改服务地址的两种方式：

```powershell
# A. 环境变量（最省事）
$env:DSH_SPEAK_URL = "http://192.168.1.20:8770"
```

```yaml
# B. 写进 profile 的 cordis.patch.yml（config 整体替换，字段要写全）
- id: dsh-speak
  config:
    baseUrl: 'http://192.168.1.20:8770'
    outDir: ''
```

**音色不在插件里配**。它由服务端按人设决定，想改就调服务：

```powershell
curl.exe -s http://127.0.0.1:8770/v1/voices?zh=1
# 用 Node 发 POST，避开 PowerShell 5.1 对内联 JSON 的引号问题
node -e "fetch('http://127.0.0.1:8770/v1/voice',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({voiceId:'voc_xxxxxxxx'})}).then(r=>r.text()).then(console.log)"
```

## 常见问题

### 1. 返回 `UNREACHABLE`

speak 服务没起。先探活：

```powershell
curl.exe -s http://127.0.0.1:8770/v1/health
```

有 JSON 说明服务活着，问题在 `baseUrl`；连不上就把 DSH-MultiTool 的 `speak/server.js` 起起来（Windows 可双击 `speak/start-server.cmd`）。

### 2. 返回 `503 BREEZEBLUE_UNAVAILABLE`

云端重试 4 次（等待 1s、2s、4s）仍失败。按 `lastError` 分三种：

- `BREEZEBLUE_NO_KEY`：key 文件不存在或为空 → 去申请，写到 `breezeblue.keyPath`；
- `BREEZEBLUE_HTTP_401/403`：key 过期或被吊销；
- `BREEZEBLUE_HTTP_429`：额度/并发问题 → 等一会儿，或查 `/v1/balance` 看余额。

**它不会回退本地音色**，这是设计：宁可这次没声音，也不给你一个音色不一致的替代品。

### 3. 听到的是 Yaoyao 那种机械音，不是人设音色

说明这次调用**显式传了本地音色**（`voice:"yaoyao"` / `"huayan"`）。`say` 的工具描述里列了这些名字，模型有时会自作主张替你选。让它「voice 传空字符串」就会回到人设云端音色。

确认这次到底走了哪条路：

```powershell
curl.exe -s http://127.0.0.1:8770/v1/usage
# lastCall.provider: breezeblue = 云端；winrt / piper = 本地
```

想彻底禁止本地引擎：服务端 `config.json` 设 `"strictAllowExplicitLocal": false`，之后显式点名本地音色会 400 `LOCAL_VOICE_BLOCKED`。

### 4. 返回 `QUEUE_TIMEOUT` / `QUEUE_FULL`

并发上限只有 1，所有句子在服务端串行排队：

- `QUEUE_TIMEOUT`：排了 180 秒还没轮到（前面堵了太多句）；
- `QUEUE_FULL`：队列超过 64 条，直接拒收。

一次只合成一两句；做整集视频交给 studio，它自己会串行处理。

### 5. WAV 文件越攒越多

插件**不负责清理**——文件可能还要被播放、转写或交给别的工具。默认落在系统临时目录，交给系统清理策略即可；想自己管就把 `outDir` 指到一个会定期清理的目录。

## 实现说明

- 单文件 `index.js`（约 220 行），零依赖，只用 `fetch` + `fs/promises`。
- 调用链：`say` → `POST {baseUrl}/v1/speak` → 拿到 `audio/*` 字节 → 以 uuid 文件名落盘 → 返回绝对路径。DSH 的工具输出是文本/JSON，塞不进二进制，所以给路径而不是给音频。
- 失败不抛异常：连不上 → `UNREACHABLE`；90 秒没回 → `TIMEOUT`；返回不是音频 → `TTS_FAILED` / `HTTP_xxx`；音频不足 44 字节 → `EMPTY_AUDIO`。每条都带 `hint`。
- 服务端（`speak/server.js`）：strict 重试策略、串行队列、人设音色打分缓存（`data/speak/persona-voice.json`，人设 version 变了才重选）、云端 mp3 → wav 转封装、按字符核对账本。
- 人设音色不是写死的：读记忆服务的 `block`/`traits`，按性别/年龄感/情绪色调给 9 个中文音色打分，取最高分。`GET /v1/voice` 会把「为什么选它」的分数一并返回。
- 扩展：任何实现了 `POST /v1/speak` 返回音频的服务都可以替换后端；插件只认 `content-type` 和字节数。

## License

MIT © 2026 lingbaojun233
