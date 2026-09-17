import { realpathSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

// Explicit outer confinement prototype. Not yet wired into Cursor sessions.
// The inherited environment and Cursor's --sandbox flag are not isolation proof.
const sharedTemporaryRoots = ['/tmp', '/private/tmp', '/var/tmp', '/private/var/tmp'];
const protectedDirectories = ['.git', '.cursor', '.codex', '.agents'];
const within = (root, path) => {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
};
const pathEntry = (path, access) => ({ path: { type: 'path', path }, access });

export function isolatedLaunch({ codexPath, workspace, runtimePaths, command }) {
  if (process.platform !== 'darwin') throw new Error('This prototype is verified only on macOS');
  if (!isAbsolute(workspace) || !isAbsolute(codexPath)) throw new Error('Absolute paths required');
  const cwd = realpathSync(workspace);
  if (cwd === '/' || sharedTemporaryRoots.some(root => within(root, cwd))) {
    throw new Error('Use a dedicated workspace outside shared temporary roots');
  }
  if (!Array.isArray(command) || !command.length || !isAbsolute(command[0])) {
    throw new Error('An absolute executable is required; shell command strings are unsupported');
  }
  if (!Array.isArray(runtimePaths) || !runtimePaths.length) throw new Error('Explicit runtime paths required');
  const readable = [...new Set(runtimePaths.map(path => {
    if (!isAbsolute(path)) throw new Error('Runtime paths must be absolute');
    const resolved = realpathSync(path);
    if (resolved === '/' || within(resolved, cwd) || within(cwd, resolved)) {
      throw new Error('Runtime access must not overlap the writable workspace');
    }
    return resolved;
  }))];
  const executable = realpathSync(command[0]);
  if (!readable.some(root => within(root, executable))) throw new Error('Executable is outside declared runtimes');
  const state = {
    permissionProfile: {
      type: 'managed',
      file_system: {
        type: 'restricted',
        entries: [
          { path: { type: 'special', value: { kind: 'minimal' } }, access: 'read' },
          ...readable.map(path => pathEntry(path, 'read')),
          pathEntry(cwd, 'write'),
          ...protectedDirectories.map(name => pathEntry(`${cwd}/${name}`, 'read')),
          ...sharedTemporaryRoots.map(path => pathEntry(path, 'deny')),
          // Plain path exclusions do not override this launcher's platform scratch grants.
          // Its glob exclusions emit explicit kernel denies; verify both with the native probe.
          ...sharedTemporaryRoots.map(path => ({ path: { type: 'glob_pattern', pattern: `${path}/**` }, access: 'deny' })),
        ],
      },
      // There is intentionally no network or permission-upgrade option.
      network: 'restricted',
    },
    sandboxCwd: pathToFileURL(cwd).href,
    codexLinuxSandboxExe: null,
    useLegacyLandlock: false,
  };
  return {
    executable: realpathSync(codexPath),
    args: ['sandbox', '--sandbox-state-json', JSON.stringify(state), '--', executable, ...command.slice(1)],
    cwd,
    state,
  };
}
