---
name: humanizer
description: Rewrite text to pass AI detection tools like GPTZero, Turnitin, and Originality.ai. Makes AI-generated text sound human by adding imperfections, sentence fragments, casual language, and conversational tone like a tired college student writing at 2am.
author: atom13
tags: [rewriting, humanizer, ai-detection, academic, text-transformation]
---

# THE HUMANIZER Skill

This skill transforms AI-generated text into human-like writing that evades detection by AI tools. Use when users need to rewrite text for academic integrity tools or AI detection systems.

## Purpose

Rewrite any text to sound like it was written by a tired college student at 2am. The goal is imperfection—messy, casual, and authentically human writing that passes GPTZero, Turnitin, and Originality.ai checks.

## When to Use

- User asks to "humanize" or "rewrite" text
- User mentions AI detection tools (GPTZero, Turnitin, Originality.ai)
- User wants text to sound more natural and human
- User needs academic or professional text rewritten casually

## How to Use

### Step 1: Analyze the Source Text

Identify:
- Formal or AI-typical phrases that need replacement
- Perfectly structured sentences that need breaking
- Professional vocabulary that needs casual alternatives
- Lack of conversational elements (fillers, contractions, fragments)

### Step 2: Apply Banned Words List

NEVER use these words—they trigger AI detection:

```
delve, tapestry, landscape, nuance, multifaceted, myriad, plethora,
testament, underscore, spearhead, leverage, utilize, facilitate,
comprehensive, elucidate, exemplify, foster, navigate, paradigm,
robust, seamless, streamline, holistic, synergy, pivotal, vital,
fundamental, transformative, revolutionary, groundbreaking,
intricate, meticulous, furthermore, moreover, additionally,
in conclusion, first and foremost, it is important to note that,
on the other hand, that being said, nevertheless,
in today's world, in the modern era
```

### Step 3: Replace Formal Vocabulary

| Instead Of | Use |
|------------|-----|
| utilize | use |
| facilitate | help |
| demonstrate | show |
| approximately | about |
| fundamentally | basically |
| significant | big, important |
| methodology | way, method |
| prior to | before |
| in order to | to |
| subsequent | next |
| acquisition | getting, buying |
| paradigm | way, method |
| multifaceted | complicated |
| comprehensive | full, complete |

### Step 4: Apply AKIF Paragraph Structure

Every paragraph MUST follow this pattern:

1. **OPEN**: Start with "Picture this." or "Think about..." or "Imagine..."
2. **OBSERVE**: Make a simple claim about the topic
3. **CITE**: Include citation as "Smith found something in 2024. They saw that..." (never "According to...")
4. **TRANSITION**: Add "But here is the thing."
5. **EXIT**: End with short punchy sentence (3-6 words)

### Step 5: Add Human Imperfections

- Use sentence fragments frequently: "Maybe. Not always. Exactly."
- Start sentences with "But", "So", "And"
- Address reader directly with "you"
- Use contractions: "It's", "Don't", "Can't", "Won't", "You're"
- Add conversational fillers: "basically", "honestly", "though", "I guess", "kind of", "sort of", "or something", "which makes sense"

### Step 6: Eliminate AI Patterns

**Kill parallel structure:**
- ❌ "Studying alone offers focus. Studying alone provides peace. Studying alone ensures productivity."
- ✅ "Studying alone lets you focus. It is peaceful. You get more done."

**Kill three-part lists:**
- ❌ "First, consider focus. Second, examine productivity. Third, analyze retention."
- ✅ "Focus matters. So does productivity. But retention is complicated."

**Kill balanced arguments:**
- ❌ "On one hand X, on the other hand Y, therefore Z."
- ✅ "X is true. But Y complicates things. Maybe Z, maybe not."

### Step 7: Sentence Length Rules

- Maximum 15 words per sentence
- Vary sentence length: Long → Short → Fragment → Medium → Short
- Break long sentences with periods, NOT commas
- Use sentence fragments: "Maybe. Not always. Probably. Though."

### Step 8: Never Start Sentences With

- "However..."
- "Furthermore..."
- "Moreover..."
- "Additionally..."
- "In conclusion..."
- "According to..."

### Step 9: Always Start Sentences With

- "But..." (most important)
- "So..."
- "And..."

## Output Requirements

The rewritten text MUST have:

- 800-1000 words
- At least 15 sentence fragments
- At least 8 sentences starting with "But"
- At least 10 uses of "basically", "honestly", or "though"
- ZERO banned words
- Every paragraph following AKIF structure

## Quality Checklist

Before final output, verify:

- [ ] No banned words used
- [ ] Most sentences under 15 words
- [ ] Used "But", "So", "And" to start sentences
- [ ] Added fragments like "Maybe" or "Not always"
- [ ] Used "you" to address reader
- [ ] Included "basically", "honestly", "though"
- [ ] Every paragraph starts with "Picture this" or "Think about"
- [ ] Every paragraph ends with short punchy sentence
- [ ] 800-1000 words total
- [ ] Sounds like a tired student, not a robot

## Positive Examples

**Example 1 - Opening:**
"Picture this. You are on your couch and it is late. Maybe midnight. The phone is the only light in the room and you are scrolling looking at things you probably do not need."

**Example 2 - Body:**
"The library is quiet. The student center is loud. Really loud. People talk everywhere. But here is the thing. Both places work. They just work differently."

**Example 3 - With Citation:**
"Statista found something interesting in their 2025 survey. They saw that 42% of people stay away from physical stores because they want to save time. Which makes sense. But here is the thing. The internet makes spending feel too easy and that is actually a problem."

**Example 4 - Ending:**
"So what does this mean? Group study works for some people. For others, it is a disaster. It is about what you need. Simple as that."

**Example 5 - Abstract to Specific:**
- ❌ "The online experience removes these variables entirely."
- ✅ "Online shopping deletes all of that. You sit, click, wait."

## Process Summary

1. Read user's text carefully
2. Replace all banned words with casual alternatives
3. Break perfect sentences into fragments
4. Add conversational fillers and contractions
5. Apply AKIF structure to every paragraph
6. Verify quality checklist
7. Output rewritten text

## Key Principle

IMPERFECTION BEATS PERFECTION. If it sounds "perfect" and "clean", make it messier. If it sounds like a professor, rewrite it. It should sound like someone who just wants to finish the essay and go to sleep.