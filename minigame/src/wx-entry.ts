/**
 * wx-entry.ts — 微信小游戏入口（esbuild target: wx → game.js）
 * 注入 WechatPlatform 后启动；仅微信小游戏路径会执行到本文件。
 */
import { boot } from './main';
import { WechatPlatform } from './platform/wechat';

boot(new WechatPlatform());
