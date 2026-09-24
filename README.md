# Claude Code plugins by Annetaan

A [Claude Code](https://claude.com/claude-code) plugin marketplace from
Annetaan Inc.

We use these plugins in our own work, and we publish them for anyone to use.
They work in whatever language you talk to Claude in.
If something breaks for you, please open an issue. Pull requests are welcome too.

## Install

```
/plugin marketplace add annetaan/claude-plugins
/plugin install <name>@annetaan
```

To pick up later changes:

```
/plugin marketplace update annetaan
```

## Plugins

| Plugin | Install | What is in it |
| --- | --- | --- |
| [annetaan](plugins/annetaan) | `/plugin install annetaan@annetaan` | [workflow](plugins/annetaan/skills/workflow), which runs one implementation as design, approval, per-task implement and review rounds, an integration review, and a pull request. The review rounds go through [difit](https://github.com/yoshiko-pg/difit). Also [doc-meta, doc-review and doc-revise](plugins/annetaan/README.md#doc-meta), which let you flag sentences in a document with an opinion and have the document revised to match. |

## License

MIT. See [LICENSE](LICENSE).
