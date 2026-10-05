// 打包前端依赖为一个浏览器脚本：npm run build:vendor
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
window.Vendor = { marked, DOMPurify, hljs, Terminal, FitAddon };
