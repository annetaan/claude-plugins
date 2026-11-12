# The interview

This file uses `$VIDEO` as SKILL.md gives it. Read it once, then run the rounds.

## How to ask

Ask in plain text rounds. Do not use `AskUserQuestion` here. Each round has numbered questions, and each question carries a recommended answer drawn from what the user has said so far. The user can reply "1 ok, 2 ...".

When the user is stuck, propose two or three concrete options. A made-up example is better than an empty box.

Go on only when the round is settled. Three to five rounds in all. A user with little to say gets short rounds, not more of them.

## Round 0: the frame

Ask these first.

1. **Use.** Which type: `concept`, `pitch` or `team`. See the table below. Recommend `concept`.
2. **Language.** The video's language. Recommend the language you are talking in.
3. **Aspect.** 16:9 by default. 9:16 for a phone screen, 1:1 for a feed.
4. **Material.** Whether they have a track with a known BPM, pictures or clips. If they have none, say so plainly: the video will still be complete. Missing pictures become placeholder cards, and the music is synthesized.

## The branches

One section each. Ask what is written here, and judge the answer by what a good one looks like.

### 1. One persona

Ask for one person, with a name and a situation. "Mika, 34, gets home at 6:10 with a child to feed." A good answer is a person you could picture at a door. "Busy parents" is a group, so ask again.

### 2. Today's pain

Ask what goes wrong for this person today, in one scene. This is the villain. A competitor appears only as "the old way". A good answer has a time of day and a feeling.

### 3. The first encounter

Ask how the persona first meets the service. Is it an app, a site, a box at the door? A good answer is one concrete moment, not a list of channels. It decides whether the story uses a screen cut.

### 4. The peak

Ask for the moment the persona says "wow". There is one. It becomes the peak of the video, and the music is written to land on it. A good answer is something you can see happen, such as a number counting up or a lid opening.

### 5. The new everyday

Ask what the persona's day looks like a month later. A good answer repeats the pain from branch 2 with the opposite ending.

### 6. The headline

Ask for one sentence short enough to post as a tweet, which the video says once at the end. A good answer has no list in it.

### 7. Three values

Ask for the three things the service gives the persona. No more and no fewer. A good answer is three short phrases that a customer would say, not feature names.

## What to stay out of

Do not ask about revenue, pricing strategy, market size or competitor analysis. If the user brings them up, note them and steer back to the persona.

## The types

| Type | For | Default length | Default bpm | Scene template (role, bars) | Notes |
| --- | --- | --- | --- | --- | --- |
| `concept` | prospects, such as a landing page | 30 to 45 s | 96 to 110 | pain 3, encounter 3, peak 4, everyday 4, headline 3 | plays muted, so telops carry everything. No narration |
| `pitch` | investors | 45 to 55 s | 100 to 116 | pain 3, encounter 3, peak 4, points 6 (the three values), headline 3, optionally one-more-thing 2 | narration offered |
| `team` | the team's own alignment | 40 to 50 s | 90 to 104 | pain 4, encounter 3, peak 4, everyday 5, headline 3 | more of the persona's detail |

The roles are the ones the renderer accepts: `pain`, `encounter`, `peak`, `everyday`, `headline`, `points`, `one-more-thing`. Every type stays under 60 seconds, and `check` refuses anything longer (`too-long`).

The bar counts are starting points. One bar is `beats_per_bar × 60 / bpm` seconds. At 96 bpm in 4/4 that is 2.5 s, so `concept` (17 bars) runs 42.5 s. At 116 bpm the 21-bar `pitch` runs 43.4 s. At 100 bpm it runs 50.4 s. State the length the chosen bpm gives before you show the scene list.

## The Brief

Write it in the interview's language, in this shape, one or two lines each:

```
## Brief

Use: <type, and who watches>
Persona: <name and situation>
Pain: <what goes wrong today>
Encounter: <how they meet the service>
Peak: <the wow moment>
New everyday: <the day a month later>
Three values: <one, two, three>
Headline: <one sentence>
Material: <the track with its BPM, pictures and clips the user supplied, or "none">
Narration: <yes or no>
```

`Narration:` is `no` for `concept`. For `pitch`, offer it and write the user's answer. For `team`, ask.

## The scene list

Draw it from the type's template and the Brief. One line per scene:

```
1. <name> | <role> | <bars> bars | <seconds> s | <one line of purpose>
```

Give each scene a name that says what happens in it, not its role. Put the values in `points` scenes, or in `everyday` when the type has no `points`. Add the total length at the end.
