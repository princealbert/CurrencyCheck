/**
 * web-entry.ts — 浏览器开发入口（esbuild target: web）
 * 注入 BrowserPlatform 后启动；仅浏览器路径会执行到本文件。
 */
import { boot } from './main';
import { BrowserPlatform } from './platform/browser';

boot(new BrowserPlatform());
