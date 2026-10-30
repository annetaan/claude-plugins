# Claude Code plugins by Annetaan

A [Claude Code](https://claude.com/claude-code) plugin marketplace from
Annetaan Inc.

We use these plugins in our own work, and we publish them for anyone to use.
They work in whatever language you talk to Claude in.
If something breaks for you, please open an issue. Pull requests are welcome too.

## Install

```
/plugin marketplace add annetaan/claude-plugins
/plugin install annetaan@annetaan
```

Installed plugins stay at their version until you update them. To pick up later changes, run this in a shell,
then `/reload-plugins` in any session that is already open:

```
claude plugin marketplace update annetaan
claude plugin update annetaan@annetaan
```

Or let Claude Code do it. Open `/plugin`, go to Marketplaces, pick `annetaan` and choose Enable auto-update.

## Plugins

| Plugin | Install | Skills |
| --- | --- | --- |
| [annetaan](plugins/annetaan) | `/plugin install annetaan@annetaan` | [11 skills](plugins/annetaan/README.md#skills) |

- [workflow](plugins/annetaan/skills/workflow) runs one implementation, from design to pull request.
- [pj1-plan, pj2-issues, pj3-doctor and pj4-running](plugins/annetaan/README.md#pj1-plan-pj2-issues-pj3-doctor-pj4-running)
  run larger work as projects on GitHub, each task implemented through workflow.
  [pj-auto](plugins/annetaan/README.md#pj-auto) drives a project until it needs you, and
  [pj-cleanup](plugins/annetaan/README.md#pj-cleanup) tidies up once you have merged it.
- [doc-write](plugins/annetaan/README.md#doc-write) and
  [doc-meta, doc-review and doc-revise](plugins/annetaan/README.md#doc-meta) write and revise documents.

[How the skills fit together](plugins/annetaan/README.md#how-the-skills-fit-together) explains how workflow and the
pj skills relate.

## License

MIT. See [LICENSE](LICENSE).
