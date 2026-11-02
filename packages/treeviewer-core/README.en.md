# treeviewer-core

A Node adapter engine for TreeViewerCommandLine with no dsh dependency; usable standalone.

- Persistent CLI process with a prompt-driven protocol (interactive questions answered by policy,
  cancellation kills the child);
- Module catalogue and option introspection (category, name, id, type, enums, ranges, colour, syntax
  hints);
- One render = one clean pipeline: open → Transformer → Further transformation → Coordinates →
  Plot action → resolution → png/svg/pdf/tiff;
- Output validation (existence, format magic, empty canvas) and an "applied settings" JSON;
- Source-trust policy (unknown `.tbi` refused by default, allow-listed by SHA-256);
- Structured errors `{ ok:false, error:{ code, message, hint?, details? } }`.

```js
import { TreeViewerEngine } from 'treeviewer-core'

const engine = new TreeViewerEngine()
const result = await engine.render({
  inputFile: 'tree.nwk',
  output: { format: 'png', path: 'tree.png', width: 1200 },
  presets: { layout: 'circular', showBootstrap: true },
})
console.log(result.imagePath, result.appliedSettings)
await engine.dispose()
```

Documentation: [configuration](../../docs/en/configuration.md), [usage](../../docs/en/usage.md),
[security](../../docs/en/security.md).

中文：[README.md](README.md)
