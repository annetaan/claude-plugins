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

The plugin needs `git`, `gh`, and Bun or Node.js 24 or later.

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
| [annetaan](plugins/annetaan) | `/plugin install annetaan@annetaan` | [16 skills](plugins/annetaan/README.md#skills) |

- [workflow](plugins/annetaan/skills/workflow) runs one implementation, from design to pull request, in a worktree of its own, and
  [workflow-cleanup](plugins/annetaan/README.md#workflow-cleanup) tidies up after it.
- [pj1-plan, pj2-issues, pj3-doctor and pj4-running](plugins/annetaan/README.md#pj1-plan-pj2-issues-pj3-doctor-pj4-running)
  run larger work as projects on GitHub, each task implemented through workflow.
  [pj-auto](plugins/annetaan/README.md#pj-auto) drives a project until it needs you, and
  [pj-cleanup](plugins/annetaan/README.md#pj-cleanup) tidies up once you have merged it.
  [pj-roadmap](plugins/annetaan/README.md#pj-roadmap) brings your roadmap file into the format they read, through a pull request.
- [level](plugins/annetaan/README.md#level) proposes the repository's level, which sets how much model the
  design, the implementation and the review get, through a pull request.
- [doc-write](plugins/annetaan/README.md#doc-write) and
  [doc-meta, doc-review and doc-revise](plugins/annetaan/README.md#doc-meta) write and revise documents.
- [experience-video](plugins/annetaan/README.md#experience-video) interviews you about your customer's experience and
  renders a video of under one minute from it.
- [pr-humans](plugins/annetaan/README.md#pr-humans) records on a pull request, open or closed, how people took part
  in it: where it came from, what they decided and what they edited by hand.

[How the skills fit together](plugins/annetaan/README.md#how-the-skills-fit-together) explains how workflow and the
pj skills relate.

## License

MIT. See [LICENSE](LICENSE).
