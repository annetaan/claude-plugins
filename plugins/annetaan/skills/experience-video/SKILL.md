---
name: experience-video
description: Interviews you about your customer's experience, writes the story as a story.md, and renders a music-backed mp4 of under one minute from it, with no source material needed. The video sells the experience, not the product, and a missing picture or clip shows up as a placeholder you can replace later. Use it only when the user names this skill or invokes /annetaan:experience-video, because it installs npm packages, downloads a browser on its first run and writes a directory of files.
---

# experience-video

Makes a short video about what it is like to use a service. You answer a few rounds of questions about one customer's day. The skill turns the answers into a `story.md`, and a producer agent renders it into an mp4 under one minute. It needs no pictures, no footage and no music to begin with.

The idea behind it is "sell the experience, not the product", from Carmine Gallo's *The Presentation Secrets of Steve Jobs*. The video shows a person's evening getting better. It does not list features.

## You are the main session

You interview, you write the handoff file, and you ask the two approvals. You do not write cuts, fragments or music. The producer does that.

## Paths: `$VIDEO` and `$DEPS`

**`$VIDEO` below means `${CLAUDE_SKILL_DIR}`**, the absolute path of this skill's directory. **`$DEPS` means `${CLAUDE_PLUGIN_DATA}/experience-video`**, where the npm packages and the browser live. Neither is a shell variable. Replace each with the real absolute path in every command and in the producer's prompt.

## Language

Talk to the user in the user's language. The video has its own language. Ask for it in the interview, and default to the language the interview is held in.

## Before you start

Start only when the user names this skill. Run:

```
node $VIDEO/renderer/bin/ev.js setup --deps $DEPS
```

Exit 2 stops the skill. Tell the user the message of the finding, which says what is missing: node older than 20, no `ffmpeg` or `ffprobe`, or an install that failed. Tell the user once that the first run downloads packages and a browser, and takes a few minutes.

## Where the files go

Everything goes in `<slug>/` in the current directory: `story.md`, `music.js`, `assets/`, `build/` and `out.mp4`. The slug is the title in lower case with hyphens. When the directory exists, ask whether to continue in it or to use another name.

## Starting point

When the argument is the path of an existing `story.md`, skip the interview and go to Producing with that file. Otherwise run the interview.

## The interview

Read `$VIDEO/interview.md` and follow it. It ends with a Brief and a scene list.

## Gate 1: the brief and the scenes

Show the Brief, and the scene list with, per scene, its name, role, bars, seconds and one line of purpose. End with the total length. Then ask:

```
AskUserQuestion: Make the video from this brief and these scenes?
  - Make it
  - Change something
```

On a change, revise and ask again. Write nothing before the user approves.

## The handoff file

Write `<slug>/story.md` as `$VIDEO/story-format.md` describes: the frontmatter, `## Brief`, and one `## Scene N — <name>` section per scene. Put no yaml block in it. The producer adds the blocks. What the user approved at gate 1 has to reach the producer through this file, so:

- Copy the track, pictures and clips the user supplied into `<slug>/assets/`. Set `music.file` and `music.bpm` in the frontmatter, and `music.offset` when the user gave one. Without a track, set `music.bpm` only.
- Write each scene's purpose in prose, then its role and bars as approved, for example "Role: peak. Bars: 4." Name any supplied file meant for that scene.
- Fill every line of the Brief, including `Material:` and `Narration:`.

## Producing

Spawn the producer.

```
Agent(subagent_type: "annetaan:experience-video-producer", description: "produce the video",
      prompt: "Read $VIDEO/roles/produce.md first and follow the section for your mode.\n\nSkill: $VIDEO\nDeps: $DEPS\nStory: <absolute path of story.md>\n\nMode: produce")
```

`annetaan:experience-video-producer` ships with this plugin and is pinned to Fable at medium effort. **When it cannot start** (a weekly limit, a rate limit, the model is unavailable), spawn it again with the same prompt and `model: "opus"`. The effort stays medium.

The producer comes back with the path of a preview, what it fixed and what it could not fix.

## Gate 2: the preview

Tell the user the path of the preview, what the producer fixed and what it could not. The preview is half size, so say that too. Then ask:

```
AskUserQuestion: Render this at full quality?
  - Render it
  - Change something
  - Stop here
```

## Tweaking

The user says what to change, or edits `story.md` and says so. Spawn the producer again with the same paths and:

```
Mode: tweak

Request: <the user's words, or "the user edited story.md">
```

Then ask gate 2 again. This holds after `out.mp4` exists too. A change goes through a preview before the next full render.

## The full render

On "Render it", spawn the producer with `Mode: final`. It renders `out.mp4` and checks its frames.

## Handing over

Report to the user:

- the path of `out.mp4` and its length
- the image and video cuts still drawn as placeholders, each with its prompt and the path to drop a file at. A dropped-in file replaces that cut on the next render
- anything the producer could not fix
- that the user can ask for changes in words, or edit `story.md` and say so

## What the skill never does

- It never calls an image or video service.
- It never writes outside `<slug>/`.
- It never renders a video of 60 seconds or longer.
