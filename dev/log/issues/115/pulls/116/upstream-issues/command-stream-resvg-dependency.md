## Summary

`command-stream` 2.6.0 (and 2.4.0) lists `@resvg/resvg-js`, `gifenc` and `@xterm/headless` in `dependencies`. Only the terminal capture and artifact features use them, and both load them lazily:

- `src/terminal-artifacts.mjs:424` calls `await import('@resvg/resvg-js')` and `import('gifenc')`;
- `src/terminal-capture.mjs:220` calls `await import('@xterm/headless')`.

There is one exception: `src/$.mjs:43` imports `./terminal-buffer.mjs`, and that file imports `@xterm/headless` statically (line 2). So `@xterm/headless` loads on every `import 'command-stream'`, although only the terminal buffer uses it.

Every consumer therefore installs an MPL-2.0 native package and its platform binaries, even when it only runs `` $`cmd` ``. A consumer with a permissive-only licence policy has to add an exception for 13 `@resvg/*` package names.

#192 made the imports lazy. This report is about what gets installed and the licence it carries.

## Reproduction

```sh
mkdir repro && cd repro && echo '{"private":true}' > package.json
npm install --ignore-scripts --no-audit --no-fund command-stream@2.6.0
node -e "const l=require('./package-lock.json');for(const [k,v] of Object.entries(l.packages))if(v.license==='MPL-2.0')console.log(k)"
node -e "import('command-stream').then(m=>m.\$\`echo ok\`).then(r=>console.log(r.stdout.trim()))"
```

Output (Linux x64, npm 11):

```
node_modules/@resvg/resvg-js
node_modules/@resvg/resvg-js-android-arm-eabi
... 13 MPL-2.0 entries in the lockfile, 2 installed (4.3 MB) ...
ok
```

The command runs without ever loading `@resvg/resvg-js`.

Seen downstream in konard/voice-simulator ([PR 116](https://github.com/konard/voice-simulator/pull/116)). Its release scripts load `command-stream` from the lockfile, and the licence gate reported every `@resvg/resvg-js*` entry. The gate now carries 13 documented exceptions, in `scripts/policy-denylist.json`.

## Workaround

Consumers can add licence exceptions for `@resvg/resvg-js` and its `@resvg/resvg-js-*` platform packages. They can also add an `overrides` entry that points `@resvg/resvg-js` at an empty package, which breaks GIF/PNG artifacts.

## Suggested fix

Move the three packages to `optionalDependencies`, or to `peerDependencies` with `peerDependenciesMeta: { "<name>": { "optional": true } }`, as already done for `node-pty`. Then make the lazy imports report a clear error when a package is missing:

```js
async function loadOptional(name, feature) {
  try {
    return await import(name);
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error(`${feature} needs ${name}: npm install ${name}`, {
        cause: error,
      });
    }
    throw error;
  }
}
const [{ Resvg }, gifencModule] = await Promise.all([
  loadOptional('@resvg/resvg-js', 'GIF/PNG terminal artifacts'),
  loadOptional('gifenc', 'GIF terminal artifacts'),
]);
```

For `@xterm/headless`, make `terminal-buffer.mjs` (or `$.mjs`'s import of it) lazy, the way `terminal-capture.mjs` already loads it. Add a test that runs `` $`echo ok` `` with these packages absent, for example after `npm install --omit=optional`. Optional peer dependencies keep them out of the consumer's lockfile entirely. `optionalDependencies` still installs them by default, but lets consumers drop them with `--omit=optional`.
