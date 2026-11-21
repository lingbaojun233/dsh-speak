/**
 * dsh-speak
 *
 * 把 speak 模块（TTS，默认 127.0.0.1:8770）注册成 DSH 原生工具 `say`：
 * 文本 → POST /v1/speak → wav 字节 → 落盘 → 返回文件路径。
 *
 * 为什么不直接把 wav 塞进工具返回值：DSH 工具的 output 是文本/JSON，
 * 二进制塞不进去；宿主和模型真正需要的是一个能播放、能再处理的本地路径。
 *
 * 为什么 DSH_ACTION_URL 是可选的：这个插件要能脱离 DSH-MultiTool 单独装，
 * 没有宿主界面时安静跳过，不影响 say 本身成功。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export const name = 'dsh-speak';
export const inject = ['tools'];

const DEFAULT_BASE_URL = 'http://127.0.0.1:8770';
// 合成一长句（含首次加载模型）在慢机器上可能十几秒；90s 是「别把 agent 卡死」的上限。
const SPEAK_TIMEOUT_MS = 90000;
// 通知宿主只是锦上添花，5s 内送不到就算了，不能拖慢已经成功的合成。
const ACTION_TIMEOUT_MS = 5000;
// WAV 头就有 44 字节，比这还短说明服务端只给了空壳
const MIN_WAV_BYTES = 44;

function baseUrlOf(config) {
  const fromConfig = config && typeof config.baseUrl === 'string' ? config.baseUrl.trim() : '';
  const fromEnv = (process.env.DSH_SPEAK_URL || '').trim();
  return (fromConfig || fromEnv || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

// 相对路径按进程 cwd 解析：模型和用户看到的是绝对路径，后面才能确定文件在哪。
function outDirOf(config) {
  const raw = config && typeof config.outDir === 'string' ? config.outDir.trim() : '';
  return raw ? path.resolve(raw) : path.join(os.tmpdir(), 'dsh-speak');
}

function normalizeVoice(voice) {
  if (typeof voice !== 'string') return undefined;
  const trimmed = voice.trim();
  return trimmed || undefined;
}

const textBlock = (value) => [
  { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) },
];

async function synthesize(baseUrl, text, voice) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SPEAK_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/v1/speak`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(voice ? { text, voice } : { text }),
      signal: controller.signal,
    });

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('audio/')) {
      // 服务端合成失败时仍然回 200 + JSON（{ok:false,error}），
      // 只按状态码判断会把错误 JSON 当成 wav 写进文件。
      const raw = await res.text();
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = { error: raw.slice(0, 2000) };
      }
      return {
        ok: false,
        code: res.status >= 400 ? `HTTP_${res.status}` : 'TTS_FAILED',
        status: res.status,
        error: (parsed && (parsed.error || parsed.message)) || 'speak service did not return audio',
        detail: parsed,
      };
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < MIN_WAV_BYTES) {
      return {
        ok: false,
        code: 'EMPTY_AUDIO',
        status: res.status,
        bytes: buffer.length,
        error: 'speak service returned fewer bytes than a WAV header',
      };
    }
    return { ok: true, buffer, headerVoice: res.headers.get('x-speak-voice') || null };
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    return {
      ok: false,
      code: aborted ? 'TIMEOUT' : 'UNREACHABLE',
      message: aborted
        ? `no response within ${SPEAK_TIMEOUT_MS}ms`
        : String((err && err.message) || err),
      hint: `is the speak service running at ${baseUrl}? set config.baseUrl or DSH_SPEAK_URL`,
    };
  } finally {
    clearTimeout(timer);
  }
}

// 把路径交给宿主，界面才能自动播放。没有 DSH_ACTION_URL 就安静跳过。
async function notifyAction(filePath, text) {
  const url = (process.env.DSH_ACTION_URL || '').trim();
  if (!url) return false;
  // sessionId 必须带：宿主按它把动作归到"这一轮"，不带就落到默认队列，
  // 界面永远收不到（踩过：动作成功入队却回不到这一轮）。
  const sessionId = (process.env.DSH_SESSION_ID || '').trim();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'speak',
        sessionId: sessionId || undefined,
        path: filePath,
        text,
      }),
      signal: AbortSignal.timeout(ACTION_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    // 宿主没开、地址写错都不该让 say 失败：音频已经落盘了
    return false;
  }
}

export function apply(ctx, config) {
  const baseUrl = baseUrlOf(config);
  const outDir = outDirOf(config);
  const disposers = [];
  const register = (tool) => {
    const dispose = ctx.tools.register(tool);
    if (typeof dispose === 'function') disposers.push(dispose);
  };

  register({
    name: 'say',
    description:
      'Synthesize speech from text and return the local path of a WAV file. voice: yaoyao / huayan / huihui / kangkang (server falls back to its default for unsupported values). Fails with a structured code when the TTS service is unreachable.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: {
        text: { type: 'string', description: 'Text to speak. Keep it short: one or two sentences.' },
        voice: {
          type: 'string',
          description: 'Optional voice id, e.g. yaoyao / huayan / huihui / kangkang',
        },
      },
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => textBlock(value),
    },
    async execute(args) {
      const text = String(args.text || '').trim();
      if (!text) {
        return { ok: false, code: 'EMPTY_TEXT', message: 'text is required and must not be blank' };
      }

      const started = Date.now();
      const voice = normalizeVoice(args.voice);
      const result = await synthesize(baseUrl, text, voice);
      if (!result.ok) return result;

      await mkdir(outDir, { recursive: true });
      // uuid 文件名：并发调用不会互相覆盖，也避免把用户文本写进文件名
      const filePath = path.join(outDir, `${randomUUID()}.wav`);
      await writeFile(filePath, result.buffer);

      await notifyAction(filePath, text);

      return {
        ok: true,
        path: filePath,
        bytes: result.buffer.length,
        // 端到端耗时（请求 → 落盘），用户感知的就是这个数
        ms: Date.now() - started,
        voice: voice || result.headerVoice || null,
      };
    },
  });

  return () => {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        // 卸载阶段单个 disposer 抛错不该拦住其余清理
      }
    }
  };
}
