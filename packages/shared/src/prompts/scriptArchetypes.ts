/**
 * Script Archetypes
 *
 * Proven short-form video script structures with timed sections,
 * energy curves, language rules, and canonical examples.
 * Used by the script generation prompt to produce engaging,
 * simple, viral-quality scripts.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArchetypeSection {
  /** Internal beat type id used downstream (e.g. in editing recipes). */
  beatType: string;
  /** Human-readable section name shown in the prompt. */
  name: string;
  /** Purpose description for the LLM. */
  purpose: string;
  /** Target percentage of total script duration (0-1). */
  targetPercent: number;
  /** Energy level 1-5 (1 = calm/intimate, 5 = high-energy/urgent). */
  energy: number;
  /** Single-word emotional tone (matches VoiceoverSegment.emotionalTone). */
  emotion: string;
}

export interface ScriptArchetype {
  id: string;
  name: string;
  description: string;
  sections: ArchetypeSection[];
  languageRules: string;
  pacingRules: string;
  canonicalScript: string;
}

// ---------------------------------------------------------------------------
// Language & Pacing Shared Rules
// ---------------------------------------------------------------------------

const SHARED_LANGUAGE_RULES = `
- Use 6th-grade vocabulary. Simple, everyday words only.
- Maximum 15 words per sentence. Most sentences should be 5-10 words.
- No corporate speak, no jargon, no filler phrases like "in today's video".
- Write in second person ("you") to speak directly to the viewer.
- Use conversational contractions (don't, can't, won't, it's).
- Every sentence must earn its place. Cut anything that doesn't hook, teach, or move the story forward.
- Use short rhetorical questions to keep the viewer engaged.
- Concrete > abstract. "200 views" beats "low engagement".
`.trim();

const SHARED_PACING_RULES = `
- The HOOK must be spoken in under 3 seconds of audio. Make every word count.
- Target ~2.5 words per second of spoken audio.
- Each section's word count must match its percentage of total duration.
- CTA must be under 5 seconds. Short, direct, one clear action.
- Transitions between sections should feel natural, not announced.
`.trim();

// ---------------------------------------------------------------------------
// Archetypes
// ---------------------------------------------------------------------------

export const SCRIPT_ARCHETYPES: ScriptArchetype[] = [
  // -------------------------------------------------------------------------
  // 1. PROP ANALOGY
  // -------------------------------------------------------------------------
  {
    id: 'prop_analogy',
    name: 'Prop Analogy',
    description:
      'Uses a physical object or analogy to explain an abstract concept. ' +
      'Structure: bold hook, common advice setup, 3-mistake pivot, solution payoff, CTA.',
    sections: [
      { beatType: 'hook', name: 'Hook', purpose: 'Bold claim about why the viewer is failing. Reference the time limit.', targetPercent: 0.05, energy: 4, emotion: 'confident' },
      { beatType: 'setup', name: 'Common Advice Setup', purpose: 'Quote the generic advice everyone gives. Make the viewer nod along.', targetPercent: 0.08, energy: 3, emotion: 'skeptical' },
      { beatType: 'pain_point', name: 'Pain Point', purpose: 'Ask why, if they followed the advice, they still have the negative result.', targetPercent: 0.07, energy: 3, emotion: 'frustrated' },
      { beatType: 'pivot', name: 'Pivot', purpose: '"The advice didn\'t fail because X. It failed because of 3 mistakes."', targetPercent: 0.05, energy: 4, emotion: 'determined' },
      { beatType: 'mistake_1', name: 'Mistake 1 (Teaser)', purpose: 'Name the big mistake but delay the explanation to build curiosity.', targetPercent: 0.10, energy: 3, emotion: 'curious' },
      { beatType: 'mistake_2', name: 'Mistake 2 (Process)', purpose: 'Explain a misconception about how the work gets done.', targetPercent: 0.14, energy: 3, emotion: 'reflective' },
      { beatType: 'mistake_3', name: 'Mistake 3 (Mechanic)', purpose: 'The technical reason for failure. Make it specific and relatable.', targetPercent: 0.14, energy: 3, emotion: 'serious' },
      { beatType: 'solution', name: 'Solution / Payoff', purpose: 'Explain the correct way. Show the result of doing it right.', targetPercent: 0.17, energy: 5, emotion: 'excited' },
      { beatType: 'social_proof', name: 'Social Proof', purpose: '"I used this to get [Specific Result] in [Timeframe]."', targetPercent: 0.12, energy: 4, emotion: 'proud' },
      { beatType: 'cta', name: 'CTA', purpose: 'One clear call to action. Short and direct.', targetPercent: 0.08, energy: 4, emotion: 'confident' },
    ],
    languageRules: `${SHARED_LANGUAGE_RULES}
- Tone: Confident, slightly skeptical, like you're revealing a secret.
- Use a physical metaphor throughout (dominoes, Jenga, cards, glass of water).`,
    pacingRules: SHARED_PACING_RULES,
    canonicalScript: `Why consistency failed you explained in 60 seconds.

You heard it a thousand times. Post daily. Push through. And you listened.

So why are you still stuck under 1,000 views?

Consistency didn't fail because it doesn't work. It failed because you made one of three mistakes.

Mistake one. Quitting right before the compound effect kicks in. But to understand that, you need to understand the next two mistakes.

Mistake two. Expecting instant success before repeated failure. Your voice doesn't appear first. It's revealed through trial and error.

Mistake three. And the most common one. Repetition alone is not progress. If you don't study what worked and improve the next post, nothing will change.

Earlier, I mentioned the compound effect. That's when consistent daily actions, powered by studying and educated trial and error finally clicks. Taking you from 200 views, to 20k, and finally a Million.

Most people just quit right before it happens.

I use this exact process with my clients. Experiment, study what worked, improve, and repeat. In under 30 days we hit our first million view video.

Want to know exactly how I did that? DM me GROW and I'll show you.`,
  },

  // -------------------------------------------------------------------------
  // 2. VULNERABLE STORYTELLER
  // -------------------------------------------------------------------------
  {
    id: 'vulnerable_storyteller',
    name: 'Vulnerable Storyteller',
    description:
      'Intimate, "older sibling" tone. Acknowledges a real struggle, ' +
      'shares a personal story, then reframes it with a mindset shift.',
    sections: [
      { beatType: 'filter', name: 'The Filter', purpose: '"If [action] feels impossible right now, this is for you." Qualify the audience immediately.', targetPercent: 0.08, energy: 2, emotion: 'intimate' },
      { beatType: 'reframing', name: 'The Reframing', purpose: 'Acknowledge the surface fear, then dismiss it. "People say it\'s X, but it\'s actually Y."', targetPercent: 0.17, energy: 3, emotion: 'reflective' },
      { beatType: 'shadow', name: 'The Shadow Struggle', purpose: 'Describe the exact behavior of someone stuck in this loop. Be vulnerable and specific.', targetPercent: 0.25, energy: 1, emotion: 'vulnerable' },
      { beatType: 'realization', name: 'The Realization', purpose: 'The mindset shift. Not a hack, but a truth about human nature.', targetPercent: 0.25, energy: 3, emotion: 'hopeful' },
      { beatType: 'permission', name: 'The Permission', purpose: 'Give them permission to be messy. Warm, encouraging sign-off.', targetPercent: 0.17, energy: 4, emotion: 'warm' },
      { beatType: 'signoff', name: 'Sign-off', purpose: 'Short, warm closing. "See you inside." or "You got this."', targetPercent: 0.08, energy: 3, emotion: 'calm' },
    ],
    languageRules: `${SHARED_LANGUAGE_RULES}
- Tone: Intimate, quiet confidence. NOT hype or motivational-speaker energy.
- Use first person ("I") when sharing your story. Switch to "you" for the viewer.
- Be specific about the struggle. "Three months paying for a gym membership I only used to shower" beats "I was scared to go."`,
    pacingRules: `${SHARED_PACING_RULES}
- The Shadow Struggle section should feel slow and heavy. Longer sentences are OK here.
- The Realization should build gradually, not hit all at once.`,
    canonicalScript: `If walking into the weight room feels impossible right now, this is for you.

And yes, I'm filming this from my car because I couldn't go in yet.

We convince ourselves the fear is about people judging our form. But that's not it. The real fear is taking up space in a room full of people who look like they belong there. It's the fear of being the before picture in a room full of afters.

That's why I spent three months paying for a membership that I only used to shower. Convincing myself I needed a better plan first. While watching everyone else get stronger and feeling smaller every day.

But what I realized is that no one is looking at you. They are too busy fighting their own demons in the mirror. We don't wait for the anxiety to leave. We just lift with it.

The only bad workout is the one that didn't happen.

See you inside.`,
  },

  // -------------------------------------------------------------------------
  // 3. MYTH BUSTER
  // -------------------------------------------------------------------------
  {
    id: 'myth_buster',
    name: 'Myth Buster',
    description:
      '"Everyone says X but here is the truth." Presents a common belief, ' +
      'explains why people believe it, then reveals the real answer with proof.',
    sections: [
      { beatType: 'hook', name: 'Bold Claim', purpose: 'A provocative statement that challenges common wisdom. Make them stop scrolling.', targetPercent: 0.05, energy: 5, emotion: 'surprised' },
      { beatType: 'myth', name: 'The Myth', purpose: 'State the common belief clearly. Make the viewer recognize themselves.', targetPercent: 0.12, energy: 3, emotion: 'skeptical' },
      { beatType: 'why_believed', name: 'Why People Believe It', purpose: 'Explain why this myth is so persistent. Show empathy, not judgment.', targetPercent: 0.17, energy: 3, emotion: 'reflective' },
      { beatType: 'truth', name: 'The Truth', purpose: 'Reveal the real answer. Be specific and concrete.', targetPercent: 0.25, energy: 4, emotion: 'confident' },
      { beatType: 'proof', name: 'Proof', purpose: 'Show evidence: data, personal results, client results, or a demonstration.', targetPercent: 0.25, energy: 4, emotion: 'proud' },
      { beatType: 'cta', name: 'Takeaway + CTA', purpose: 'One actionable takeaway. Then a clear CTA.', targetPercent: 0.16, energy: 5, emotion: 'excited' },
    ],
    languageRules: `${SHARED_LANGUAGE_RULES}
- Tone: Authoritative but casual. "Here's what nobody tells you" energy.
- Use contrast: "Everyone says X. The truth? Y."
- Numbers and specifics are powerful here. "87% of people" or "after 6 weeks".`,
    pacingRules: `${SHARED_PACING_RULES}
- The Bold Claim should be punchy and provocative. 1-2 sentences max.
- The Truth section should build with layered evidence, not just one statement.`,
    canonicalScript: `Everything you know about morning routines is wrong.

You've been told to wake up at 5 AM. Meditate. Journal. Cold plunge. Follow the exact routine of some billionaire you've never met.

And it makes sense. If it worked for them, it should work for you, right? That's why you tried it. Maybe even stuck with it for a week. Before falling right back to snoozing your alarm.

Here's the truth. The best morning routine is the one you'll actually do. Not the one that sounds impressive. Your brain needs exactly two things in the first hour. Movement and daylight. That's it. A 10-minute walk outside does more than an hour of forced meditation you hate.

I tested this with 200 clients. The ones who built a 15-minute routine they enjoyed? 89% were still doing it after 90 days. The ones who copied a YouTube guru? 12%.

Stop copying routines. Build yours around what you actually enjoy. Save this for tomorrow morning.`,
  },

  // -------------------------------------------------------------------------
  // 4. RAPID FIRE TIPS
  // -------------------------------------------------------------------------
  {
    id: 'rapid_tips',
    name: 'Rapid Fire Tips',
    description:
      '3-5 actionable tips with punchy delivery. Each tip is a self-contained ' +
      'mini-lesson with a clear do-this-not-that structure.',
    sections: [
      { beatType: 'hook', name: 'Hook', purpose: 'Promise a specific number of tips for a specific result. "3 things that..." or "Stop doing these 4..."', targetPercent: 0.07, energy: 5, emotion: 'urgent' },
      { beatType: 'tip_1', name: 'Tip 1', purpose: 'First and most surprising tip. Lead with your strongest.', targetPercent: 0.20, energy: 4, emotion: 'confident' },
      { beatType: 'tip_2', name: 'Tip 2', purpose: 'Second tip. Build on the first or contrast it.', targetPercent: 0.20, energy: 4, emotion: 'determined' },
      { beatType: 'tip_3', name: 'Tip 3', purpose: 'Third tip. Save the most actionable for last.', targetPercent: 0.20, energy: 4, emotion: 'excited' },
      { beatType: 'bonus', name: 'Bonus / Secret', purpose: '"And here\'s the one nobody talks about..." A bonus insight that rewards viewers who stayed.', targetPercent: 0.20, energy: 5, emotion: 'surprised' },
      { beatType: 'cta', name: 'CTA', purpose: 'Direct call to action. Save, follow, or comment.', targetPercent: 0.13, energy: 4, emotion: 'confident' },
    ],
    languageRules: `${SHARED_LANGUAGE_RULES}
- Tone: Punchy, imperative. "Do this. Not that."
- Number each tip clearly: "Number one.", "Tip two.", "And the last one."
- Each tip should be immediately actionable, not theoretical.`,
    pacingRules: `${SHARED_PACING_RULES}
- Every tip should be roughly equal in duration.
- The Bonus section should feel like a reward. Slight pause before it.
- Energy stays high throughout. This is not a slow build.`,
    canonicalScript: `3 things killing your content that nobody will tell you.

Number one. You're starting too slow. The first two seconds decide everything. Don't introduce yourself. Don't set context. Start with the most interesting thing you have to say.

Number two. Your captions are boring. White text on a black bar? That's a news broadcast, not a viral video. Use bold, animated text that matches your energy. Highlight the keywords.

Number three. You're posting and ghosting. The first 30 minutes after you post matter more than anything. Reply to every comment. Ask questions back. The algorithm rewards conversations, not just views.

And here's the one nobody talks about. Your content isn't bad. Your packaging is. Same video with a better hook, better thumbnail, better first frame? Completely different result.

Save this and thank me later. Follow for more.`,
  },
];

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Look up an archetype by id. Returns undefined if not found.
 */
export function getArchetype(id: string): ScriptArchetype | undefined {
  return SCRIPT_ARCHETYPES.find((a) => a.id === id);
}

/**
 * Build the section breakdown string for the LLM prompt.
 * Example output:
 *   1. Hook (5%) [Energy: 4, Emotion: confident] -- Bold claim about why the viewer is failing.
 */
export function formatSectionsForPrompt(
  sections: ArchetypeSection[],
  targetDurationSeconds: number,
): string {
  return sections
    .map((s, i) => {
      const durationSec = Math.round(s.targetPercent * targetDurationSeconds);
      return `${i + 1}. ${s.name} (~${durationSec}s, ${Math.round(s.targetPercent * 100)}%) [Energy: ${s.energy}/5, Emotion: ${s.emotion}] -- ${s.purpose}`;
    })
    .join('\n');
}
