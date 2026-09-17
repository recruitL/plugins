#!/usr/bin/env node
// Load the user's separate upstream checkout; do not redistribute unlicensed code.
import {execFileSync} from 'node:child_process';
import {realpathSync,readFileSync} from 'node:fs';
import {isAbsolute,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {installUpstreamPolicy} from './upstream-policy.mjs';
const revision = 'ce257353ecae9061fe45d084cb80e2d0c46207cd';
const source = process.env.CURSOR_SUBAGENT_UPSTREAM;
if (!source || !isAbsolute(source)) throw new Error('An absolute CURSOR_SUBAGENT_UPSTREAM checkout is required');
const root = realpathSync(source);
const git = (...args) => execFileSync('/usr/bin/git',args,{cwd:root,encoding:'utf8',timeout:5000}).trim();
if (git('rev-parse','HEAD') !== revision || git('status','--porcelain','--untracked-files=no')) {
  throw new Error('Use the pinned, unmodified upstream checkout');
}
if (!process.env.CURSOR_SUBAGENT_ALLOWED_ROOTS) throw new Error('Explicit authorized workspace roots are required');
if (!isAbsolute(process.env.CURSOR_AGENT_COMMAND ?? '')) throw new Error('An absolute verified Cursor CLI path is required');
const upstream = await import(pathToFileURL(join(root,'scripts/cursor-subagent-mcp.mjs')).href);
installUpstreamPolicy(upstream.Runtime, upstream.tools, upstream.DomainError, {version:JSON.parse(readFileSync(new URL('../.codex-plugin/plugin.json',import.meta.url))).version,entry:new URL(import.meta.url).pathname,cli:process.env.CURSOR_AGENT_COMMAND,pid:process.pid});
await upstream.serve();
