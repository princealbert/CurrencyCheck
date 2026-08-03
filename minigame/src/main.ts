/**
 * main.ts — 平台无关启动入口
 *
 * boot(platform?) 接收已构造的 Platform；不传则运行时探测：
 *   - 存在 wx.createCanvas（微信小游戏，无 DOM）→ WechatPlatform
 *   - 否则 → BrowserPlatform
 * 这样「一套 src/ 逻辑共享，只入口不同」：
 *   web-entry.ts 注入 BrowserPlatform；wx-entry.ts 注入 WechatPlatform。
 */

import { Platform } from './platform/types';
import { App } from './app/app';
import { BrowserPlatform } from './platform/browser';
import { WechatPlatform } from './platform/wechat';

export function boot(platform?: Platform): void {
  if (!platform) {
    const g = globalThis as any;
    const isWx = typeof g.wx !== 'undefined' && g.wx && typeof g.wx.createCanvas === 'function';
    platform = isWx ? new WechatPlatform() : new BrowserPlatform();
  }
  const app = new App(platform);
  app.start();
}
