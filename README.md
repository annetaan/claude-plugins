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

| Plugin | Install | What is in it |
| --- | --- | --- |
| [annetaan](plugins/annetaan) | `/plugin install annetaan@annetaan` | [workflow](plugins/annetaan/skills/workflow), which runs one implementation as design, a design review where the repository accepts breaking changes, approval, then per task (implement, review rounds, one commit), then an integration review, then a finish step. The review rounds leave a file per round in the work report. Also [pj-1-plan, pj-2-doctor and pj-3-running](plugins/annetaan/README.md#pj-1-plan-pj-2-doctor-pj-3-running), which run a larger piece of work as projects on GitHub of up to ten tasks each: a parent issue with its run order and one sub-issue per task, the decisions ticked by you on GitHub and reviewed across the whole project, then each issue implemented through workflow and merged as its own pull request into its project's own branch, which you merge back into the branch it started from when the project is done. And [doc-write](plugins/annetaan/README.md#doc-write), which writes a document in one of four styles, and [doc-meta, doc-review and doc-revise](plugins/annetaan/README.md#doc-meta), which let you flag sentences in a document with an opinion and have the document revised to match. |

## License

MIT. See [LICENSE](LICENSE).
