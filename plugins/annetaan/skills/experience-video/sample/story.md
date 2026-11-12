---
title: Evening Basket
language: en
type: concept
output: { aspect: "16:9", fps: 30 }
music: { bpm: 96, beats_per_bar: 4, volume: 0.8, fade_out: 1.5 }
theme: { background: "#1d2a22", foreground: "#f6f1e7", accent: "#f2a33a" }
---

## Brief

A fictional greengrocer, Evening Basket, delivers a dinner kit to your door before six: washed vegetables, a recipe
card, and nothing to plan. The video shows the moment a tired evening turns into dinner.

Audience: people who get home late and still want to cook.

## Scene 1 — The evening question

The pain. It is six o'clock and nobody knows what is for dinner.

```yaml
role: pain
narration: "Every evening, the same question: what is for dinner?"
cuts:
  - id: question
    part: card
    bars: 3
    lines:
      - { text: "6:12 pm", style: small }
      - { text: "What is for dinner?", style: big }
    telops:
      - { text: "Again.", at: 2bars, until: end, position: bottom }
```

## Scene 2 — A basket at the door

The encounter. A basket of washed vegetables arrives with a recipe card.

```yaml
role: encounter
cuts:
  - id: basket
    part: image
    bars: 2
    prompt: A wicker basket of fresh vegetables on a doorstep at dusk
    zoom: in
    in: fade
    telops:
      - { text: "A basket at your door", at: 1beat, until: end, position: bottom, style: title }
  - id: recipe
    part: image
    bars: 1
    prompt: A hand-written recipe card tucked between two bundles of herbs
    zoom: out
    in: crossfade
```

## Scene 3 — Twenty minutes

The peak. Dinner takes twenty minutes, start to finish.

```yaml
role: peak
cuts:
  - id: twenty
    part: card
    bars: 4
    marks: { peak: 2bars }
    lines:
      - { text: "{n} min", style: big, count: { from: 45, to: 20, duration: 2bars } }
      - { text: "from the door to the table", style: small }
    telops:
      - { text: "Dinner in twenty minutes", at: peak, until: end, position: bottom, style: headline }
```

## Scene 4 — Every Tuesday and Thursday

The everyday. The basket becomes a habit.

```yaml
role: everyday
cuts:
  - id: week
    part: card
    bars: 2
    lines:
      - { text: "Tuesday", style: small }
      - { text: "Thursday", style: small }
      - { text: "Done by six", style: accent }
    stagger: 1beat
  - id: table
    part: image
    bars: 2
    prompt: A table set for two, steam rising from a pot, warm evening light
    zoom: in
    in: crossfade
    telops:
      - { text: "No planning. Just dinner.", at: 1bar, until: end, position: bottom }
```

## Scene 5 — Evening Basket

The headline. The name and the promise.

```yaml
role: headline
cuts:
  - id: headline
    part: card
    bars: 3
    out: fade
    lines:
      - { text: "Evening Basket", style: big }
      - { text: "Dinner, delivered before six", style: accent }
    telops:
      - { text: "Order by noon", at: 2bars, until: end, position: bottom }
```
