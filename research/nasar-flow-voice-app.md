# Nasar Flow — Building a World-Class Local Voice Dictation App

Research and recommendations, prepared overnight from a late-night brain dump about custom dictionaries, voice commands, and the "talk vs. type" gap.

**Scope note:** this is personal product R&D for a voice dictation app ("Nasar Flow"), unrelated to the marketing-skills content that lives in this repository's `skills/` directory. It's here only because this is where the session's working branch was created. It doesn't touch `skills/`, `VERSIONS.md`, or either plugin manifest, and isn't part of the marketing-skills release process.

## How this was researched

Four parallel research passes covered: (1) ASR architecture & latency engineering, (2) custom vocabulary & voice command design, (3) the talk-vs-type/register question, (4) builder lessons learned, evaluation methodology, and privacy architecture. Your five links were part of the brief.

**Important honesty note on sourcing:** this session's network policy blocks direct fetches to arbitrary external domains (confirmed — it's a real block, not a transient failure). That means:
- The **Jiradett Medium post**, the **hairizuan.com Swift post**, and the **Wispr Flow "dictation for developers" post** were reconstructed from multiple web-search snippets and citations of them elsewhere, not read directly end-to-end. High confidence in the specifics below (they're corroborated across several sources), but flagging it plainly rather than pretending these were fully read.
- The **Coding Challenge #135 Substack post** could not be accessed or reconstructed at all (likely paywalled with thin public preview text) — nothing reliable to report from it.
- The **YouTube video** (ZRsDQp9CrXc) could not be identified by any method available — title, uploader, and content are all unknown. Don't have anything to tell you about this one; you'll need to check it yourself.

Every claim below carries its source so you can verify anything load-bearing before you build on it.

---

## TL;DR — direct answers to your questions

1. **Custom dictionary: build it.** Every serious product in this space has one (Wispr Flow, Superwhisper, Talon). Use a layered design, not a single mechanism — see Part 1.
2. **Voice commands/macros: build it, but design the mode-switch first.** The hard problem isn't execution, it's telling "this is a command" apart from "this is dictated prose that happens to contain those words." Every reference implementation solves this architecturally (disjoint modes, hold-to-activate, context-scoping), not by statistically guessing — see Part 2.
3. **Talk vs. type: yes, and the target register should be "how you'd type this specific message," not "correct written English."** This is a real, named linguistic phenomenon (register variation), and the best products already treat the target register as *variable* by context, not fixed — see Part 3.
4. The single most useful engineering lesson across all the research: **instrument before optimizing.** The builder who cut lag from 20s→2s assumed Whisper was the bottleneck; it wasn't (0.74s) — an LLM "polish" pass was silently eating 19 of those seconds. See Part 4.

---

## Part 1 — Custom Dictionary: recommended architecture

Don't pick one mechanism — real products layer several, because each catches a different failure mode.

| Layer | What it does | Catches | Watch out for |
|---|---|---|---|
| **1. Deterministic find-and-replace** | Post-transcription exact/case-insensitive substitution against a user-maintained list | Systematic, known-wrong transcriptions ("Nassar" → "Nasar") | Cheapest, safest, zero model risk — **build this first** |
| **2. Fuzzy/edit-distance correction** | Levenshtein-based matching (e.g. FuzzyWuzzy/TheFuzz) against your dictionary, run on low-confidence or out-of-vocabulary-shaped tokens | Near-miss phonetic spellings you didn't anticipate | Needs a distance threshold tuned to avoid over-correcting real words |
| **3. Contextual biasing / hotword lists** | Engine-level: a wordlist that biases the decoder toward given spellings (NeMo/Parakeet-style shallow fusion or word-spotting) | Words the model would otherwise never produce, even after correction | Over-biasing measurably *degrades* accuracy on unrelated words past some list size — keep lists short and targeted |
| **4. Prompt-based biasing (Whisper `initial_prompt`)** | Prepending text to bias the decoder | Same as #3, Whisper-specific | Weakest option: Whisper's prompt mechanism expects a *continuation of prior speech*, not a keyword list — research found it can measurably **raise** WER and induce hallucinated words when used as a bias list. Use sparingly, if at all. |

*(Sources: NVIDIA NeMo word-boosting docs, "TurboBias" arXiv:2508.07014, Whisper prompt-limitation analysis arXiv:2410.18363 and arXiv:2502.11572, Metaphone/phonetic-matching background.)*

**How the competition does it:**
- **Wispr Flow**: a "Personal Dictionary" that auto-learns from corrections (up to 4-word phrases), plus manual entries, synced across devices, bulk CSV import, shareable as a team dictionary. Explicitly splits into (a) recognition-time *boosting* and (b) deterministic *misspelling replacement rules* — i.e., it already does layers 1 and 3 above as distinct features.
- **Superwhisper**: ships both a "Vocabulary" (recognition-time hints) and "Replacements" (deterministic post-processing) — but its own docs recommend using Vocabulary *sparingly* because it "can cause complications," and treat Replacements as the primary, reliable mechanism. This is a direct, first-party confirmation of the risk noted in layer 4 above.
- **MacWhisper**: reportedly has **no true vocabulary injection at all** — pure text-substitution (layer 1 only) — and still ships as a well-regarded product. That's a useful signal: layer 1 alone is a legitimate, shippable MVP.

**Recommendation:** ship layer 1 (deterministic replace) at launch — it's most of the value for least risk. Add layer 2 (fuzzy match) once you have real failure data from users. Only reach for layers 3/4 if you have a specific class of words (e.g. your own product/client names) that layer 1+2 keeps missing, and A/B test for regressions on unrelated speech before shipping.

---

## Part 2 — Voice Commands & Macros: recommended architecture

The mistake to avoid: trying to build a classifier that guesses, per-utterance, "is this a command or dictated text?" Every serious reference implementation sidesteps that problem entirely instead of solving it statistically:

| Product | How it avoids the ambiguity | Mode-switch mechanism |
|---|---|---|
| **Wispr Flow** | Dedicated **Command Mode**: hold a shortcut, speak the instruction, release, it executes | The held key *is* the mode switch — no ambiguity possible |
| **Talon Voice** | Two disjoint modes (command vs. dictation) rather than one grammar classifying each utterance; commands are additionally scoped per-application via "Context" definitions, so a command phrase isn't even in the active grammar unless its app is focused | Explicit mode commands, ~0.3s silence timeout before executing, an escape/"say literally" path to drop into text without leaving command mode |
| **Apple Voice Control** | Same disjoint pattern: Dictation mode (default) vs. explicit Command mode; separate sleep/wake pair fully suspends listening | Verbal mode switch ("Command mode") |
| **Windows Voice Access** | Three modes: Dictation-only, Commands-only, Default (both) — real users report the *mixed* Default mode is where confusion actually happens | Verbal mode switch |

**The pattern, stated plainly:** hold-to-activate (Wispr Flow's approach) is the simplest and lowest-risk to build — you get zero ambiguity for free, at the cost of an extra keypress. Always-on mode-switching (Talon/Apple/Windows) is more "hands-free" but needs the mode boundary itself to be unambiguous (verbal switch + timeout + escape hatch), and Talon adds a second safety net most people skip: **scoping commands to the focused app** so a command word isn't even recognized as a command unless that app is active.

**Execution mechanism** — two options, and it matters which you pick:
- **OS accessibility APIs** (macOS `NSAccessibility` / `accessibilityPerformPress()`, Windows UI Automation) — addresses a named/semantic control directly. Windows' own Voice Access docs call the UIA-numbered-control approach the *most reliable* click method, specifically because it doesn't depend on coordinates or focus state.
- **Simulated keystrokes** — the universal fallback for apps that expose no accessibility tree, and the *right* choice for pure text-editing actions where a keystroke is the native action anyway. Talon defaults to this and layers accessibility calls on top only where the OS supports it. Don't assume keystroke simulation is inherently unreliable, but prefer accessibility APIs when a target is a real, named UI control.

**Recommendation:** ship hold-to-activate command mode first (lowest engineering risk, matches Wispr Flow's proven pattern). If you later want always-on hands-free control, study Talon's context-scoping model closely before attempting your own ambiguity classifier — nobody in this space ships a classifier for this; they all ship a boundary.

---

## Part 3 — The Talk-vs-Type Problem

Your instinct — "a voice message to a friend should come out exactly as if I'd typed it to that friend" — is linguistically well-founded, not just a vibe.

**Why the gap exists:** Douglas Biber's foundational corpus-linguistics work (*Variation Across Speech and Writing*, 1988) found that speech and writing aren't two clean bins — they sit on a continuum whose main axis contrasts "involved" (interactive, real-time, personal) production against "informational" (dense, planned, edited) production. Casual conversation and personal messages cluster together on the *involved* end; edited prose sits far away. That's precisely why a verbatim transcript of speech "reads as an error" once it's typed — it's not that speech is sloppy, it's that you're comparing the wrong two points on the continuum. David Crystal's analysis of informal typed messaging ("Netspeak") goes further and argues casual texting is its own third register blending speech and writing, not simply "cleaned-up speech" — which is exactly the target you described.

**What the pipeline needs to actually do**, in order:
1. **Inverse Text Normalization (ITN)** — spoken-form → written-form ("three pm" → "3pm", "dot com" → ".com"). Industry-standard implementation is rule-based (WFST grammars, e.g. NVIDIA's NeMo-text-processing/Pynini), specifically *because* the task has near-zero tolerance for silent, confident-looking errors — neural/seq2seq approaches are documented as more hallucination-prone here.
2. **Disfluency removal** — stripping "um," "uh," false starts, repeated words, self-corrections. Academic estimates put disfluencies in roughly a third of sentences even from strong modern ASR. Sequence-tagging models (mark spans as reparandum/interregnum/repair, then delete) are the traditional approach; recent work found that prompting a general LLM to do this tends to *paraphrase* rather than surgically delete the disfluent span — worth knowing if you reach for an LLM here.
3. **Punctuation restoration & capitalization** — the best low-latency designs use small dedicated classifiers (not a full LLM) riding a few words behind the decoder, some hitting ~3-4 word lookahead. This should not be where you spend your latency budget.
4. **The register-matching pass (LLM cleanup)** — this is where Wispr Flow and Superwhisper actually differentiate, and where the real risk lives.

**The over-correction trap (read this before you build step 4):** the research surfaced a consistent, specific complaint pattern about Wispr Flow's cleanup layer: reviewers report it sometimes "improves what they actually said instead of transcribing it accurately," flattening casual phrasing into formal language and, in the worst cases, changing meaning — cited as a factor in a middling 2.7/5 Trustpilot average. This isn't a one-off; it mirrors a broader finding in LLM-based ASR-correction research, that directly prompting an LLM to "fix" a transcript risks hallucinated edits to text that was already correct.

**How the better products manage this risk:**
- **Wispr Flow** exposes a tunable intensity dial — Light (fillers + grammar only, minimal restructuring) / Medium (default) / High (heaviest rewriting) — plus a "Backtrack" feature for handling spoken self-corrections explicitly rather than silently guessing.
- **Superwhisper** ships per-app "Custom Modes" — a different prompt, model, and auto-activation rule depending on the focused app (e.g. Slack mode stays casual, Email mode adds greeting/signature) — running fully offline via Ollama. This directly matches your framing: the target register should vary by *destination*, not be one global setting.

**Recommendation for Nasar Flow:**
- Default the register target to "informal typed message" (Biber's "involved" end), not "correct written English" — that's the right target for the friend-message use case you described.
- Make the register **contextual** (per destination app, like Superwhisper) rather than a single global cleanup level.
- Keep the raw transcript retrievable/undoable behind the cleaned version — given how consistently over-correction shows up as a complaint, users need an escape hatch when the cleanup layer guesses wrong about their intent.
- Do ITN and punctuation with small, fast, deterministic-leaning components; reserve the LLM specifically for register/disfluency, where deterministic rules can't do the job — don't let one heavy LLM pass do everything (see Part 4's latency lesson — this is exactly the stage that ate 19 seconds in one real build).

---

## Part 4 — Architecture Blueprint for Local Real-Time ASR

### The most important lesson in this entire research pass

The builder who cut dictation lag from 20 seconds to 2 (your first link) assumed Whisper itself — "computationally heavy" — was the bottleneck. He was wrong. He instrumented every pipeline stage with timestamps instead of guessing, and found Whisper ran in **0.74 seconds**. The real bottleneck was a separate local-LLM "polish" pass (via Ollama) cleaning up the raw transcript — silently consuming **~19 of the 20 seconds**. The fix wasn't a faster ASR model; it was swapping to a smaller local LLM (a 3B-class model matched a 9B model's cleanup quality at a fraction of the latency). Total: ~2 seconds.

**Take this literally for Nasar Flow:** instrument every stage (capture → VAD → ASR → post-processing → LLM cleanup → text insertion) with timestamps from day one. Do not optimize the ASR model before you've measured where time is actually going — it's very likely not where you assume.

### Model choice

| Engine | Streaming-native? | Approx. accuracy | Approx. speed (reported) | Best fit |
|---|---|---|---|---|
| whisper.cpp (large-v3, GGUF Q5_1) | No — needs retrofitting | ~2.0–2.5% WER (LibriSpeech-clean) | 5–7x realtime via CoreML on M2 Pro | Max accuracy, willing to engineer streaming on top |
| faster-whisper (CTranslate2, INT8) | No — needs retrofitting | Comparable to whisper.cpp | 8–12x realtime on RTX 30/40-series | NVIDIA GPU users |
| distil-whisper | No | ~9.7% WER vs 8.4% for large-v3 (out-of-domain) | ~6x faster than large-v3 | Lower-power devices, still batch-oriented |
| **NVIDIA Parakeet-TDT (0.6B)** | **Yes — native** | ~2.6% WER (rivals large-v3) | ~30x realtime on a laptop CPU | Real streaming dictation; weaker on accented/noisy audio; English + ~25 languages |
| **Moonshine (useful-sensors)** | **Yes — native** | Competitive on short utterances | 50–260ms latency depending on model size | Lowest-latency/edge devices; English-only |
| **Apple SpeechAnalyzer/SpeechTranscriber** | **Yes — native** | Beats Whisper Small on long-form speech per one report | ~3x faster than Whisper Small per second of audio | Mac/iOS-only, zero extra deployment burden |

**Recommendation:** since Whisper's whole family is fundamentally batch-oriented and needs retrofitting (see below) to feel real-time, and you're building specifically for *low-latency local dictation*, start from a natively streaming model — Parakeet-TDT if you want cross-platform + strong accuracy, Apple's SpeechAnalyzer if you're Mac/iOS-only and want the least engineering overhead, Moonshine if raw latency is the top priority on constrained hardware.

### If you do use Whisper-family models anyway

Whisper wasn't designed to stream. The standard retrofit ("LocalAgreement," used by whisper-streaming/WhisperLive) re-runs inference on overlapping audio buffers and only emits the text that stays consistent across consecutive hypotheses — latency roughly 2x your chunk size, with real compute waste from re-processing overlapping audio. WhisperLive reports ~500–800ms latency this way and can run on a Raspberry Pi, but its audio-stream handling is reported as hard to adapt to custom inputs. This is a workable path but a strictly harder one than starting from a natively streaming model.

### VAD & endpointing

Silero VAD is the most widely used option but isn't the most accurate one available — one benchmark found it misses ~12% of speech frames at a 5% false-positive rate and lags several hundred ms on transitions; Picovoice Cobra reportedly does notably better (1.1% miss rate) and faster. The bigger design decision is the endpointing threshold itself: too short (~200ms) cuts users off mid-thought; too long (~800ms+) adds felt latency. Dictation's longer, slower utterances warrant a more conservative (longer) threshold than a conversational voice assistant would use. A hybrid pattern worth considering: frame-level VAD for the fast path, plus a small LLM reading partial transcripts for semantic "is this sentence actually finished" completion, adding under 500ms.

### Quantization & hardware acceleration

GGML/GGUF quantization is close to a free lunch at moderate levels — Q5_1 loses under 1% WER versus full precision — and runs across Metal/CUDA/Vulkan/CPU with no extra configuration. On Apple Silicon, converting to Core ML unlocks the Neural Engine specifically (not just Metal), which is where the 5–7x realtime numbers above come from. On Windows/Linux with an NVIDIA GPU, CTranslate2 (what faster-whisper is built on) does INT8 quantization plus layer fusion and batched decoding — no strong evidence was found for DirectML as a mainstream path, so don't plan around it without validating yourself.

---

## Part 5 — Lessons Learned From Builders Who Shipped This

- **On-device is the differentiator, not raw accuracy.** Several recent "Show HN" launches (Whispering, Rekody, Ghost Pepper, Utter) all lead their pitch with local/offline processing rather than accuracy claims — that's your positioning lane, and it's a crowded-but-validated one.
- **Domain-matched training data beats chasing generic benchmarks.** Aqua Voice (YC W24) trained its own model specifically on developer speech (code, terminal commands) rather than generic audiobook-style corpora, and reports 97% accuracy on jargon like "kubectl." If Nasar Flow has a specific domain (marketing/agency jargon, client names), the same principle applies to your custom-vocabulary work in Part 1.
- **Accuracy for non-native accents remains the industry's hardest unsolved problem.** Even Talon Voice's own community — arguably the most demanding, technical user base in this space — maintains a dedicated wiki just for tuning pronunciation and mic setup, rather than expecting out-of-the-box accuracy to be enough. Set expectations accordingly.
- **A privacy incident is survivable; a bad first response is not.** Wispr Flow's 2025 incident (a user's network monitor caught audio/screenshots being uploaded) blew up specifically because the company's first move was banning the user who found it — not because the technical issue itself was unforgivable. The eventual fix (opt-in-only training, a zero-retention mode) came only after public backlash. If you're positioning on privacy, plan your incident response before you need one.
- **Churn is driven by social discomfort and correction fatigue, not raw accuracy.** Talking to a machine around other people rarely survives an open office, and it's reportedly "the tenth error, not the first" that breaks a user's habit of trusting the tool. Voice also doesn't solve the blank-page problem for from-scratch creative writing — know what it's *for*.
- **Hold-to-talk reportedly beats always-on listening** for a specific, non-obvious reason: always-on forces the user into constant "microphone management" (self-censoring, pausing for side conversations) rather than giving explicit control over when they're being heard. This reinforces the Part 2 recommendation to start with hold-to-activate.
- **Even Wispr Flow, the category leader, admits a sequencing mistake**: their own strategy writing describes pushing toward "voice-to-action" and wearable ambitions before nailing reliable input first, citing Humane's AI Pin as the cautionary example of hardware/ambition preceding a proven, reliable core loop. Nail dictation before you reach for "voice control of everything."

---

## Part 6 — Privacy & Local-First, Done Right

- **"Never leaves your device" needs to be independently verifiable, not just claimed.** The credible version of this claim is checkable by any user with a standard network monitor in under a minute (one competitor, Handy, builds its positioning specifically around this). Design for that bar, not just a marketing line.
- **Local-only is not the same as private-at-rest — this is the least obvious and most actionable finding here.** An audit of six dictation apps found three (Handy, VoiceInk, OpenWhispr) store transcripts and audio locally as **unencrypted plaintext with no lock**, meaning a stolen or shared laptop exposes the full dictation history even though nothing ever crossed the network. Only one of the six encrypted at rest (AES-256-GCM). This is a real, easy differentiator: **encrypt transcripts and audio at rest from day one.**
- **Model updates without phone-home:** the credible pattern is fixing model weights at build/install time and updating only through explicit, user-initiated app updates via normal platform channels — deliberately skipping telemetry, crash reporting, and background model-fetching, since any of those quietly reopens the "does this really never leave my device" question.
- **The "on-device is too slow/hot" complaint usually isn't fundamental — it's a model/hardware mismatch.** whisper.cpp's large-v3 can reportedly be kept under 78°C on a laptop with sane configuration, and Apple Silicon with Metal runs 2–3x realtime; most overheating complaints trace back to running a large model on an 8GB-RAM machine, not to on-device processing being inherently too heavy. Size your default model to the hardware tier, don't default everyone to the biggest model.
- **Don't let cloud and local coexist as a user-toggleable setting if you're positioning on privacy.** Superwhisper's local/cloud modes coexist, which makes its privacy guarantee something a user can misconfigure rather than a structural property of the app. "Local by construction" (no cloud code path exists at all) is a stronger, simpler claim than "local by default."

---

## Part 7 — How to Evaluate Quality (Beyond WER)

Word Error Rate treats every error as equally bad, which is misleading for a real product: "Boston" → "Austin" is one word wrong but a completely failed task; "morale is raised" → "morale is razed" is one word wrong but *inverts the meaning*; both score identically to a trivial typo. For a dictation tool specifically, WER also says nothing about punctuation, formatting, or latency — all of which are part of what the user actually experiences.

Better options, in rough order of practicality for a small team:
1. **Edit-distance-after-user-correction** — how much does the user actually have to fix before they accept the output? This is closest to what people feel, though there's no agreed threshold for "good," and it doesn't capture the time cost of editing.
2. **Task Success Rate** — did the dictated command/message actually accomplish what the user intended? Borrowed from voice-agent evaluation, and arguably the most honest metric for anything beyond plain prose dictation.
3. **Semantic Error Rate / SeMaScore-style metrics** — academic approaches that weight errors by meaning-impact rather than token-count. Heavier to set up, but worth knowing exists if WER numbers ever seem to conflict with what users are actually reporting.

**Recommendation:** don't optimize for WER as your primary internal metric. Track edit-distance-after-correction from real usage, and keep a small hand-labeled set of your own jargon/proper-noun cases to sanity-check the custom-dictionary work in Part 1 specifically (since that's exactly the class of error WER underweights — a missed proper noun is one token, but often the whole point of the sentence).

---

## Part 8 — Recommended Reading

- **Douglas Biber, *Variation Across Speech and Writing* (1988)** — the foundational linguistic account of why spoken and written register differ; grounds the Part 3 recommendation in something more solid than intuition.
- **AssemblyAI, ["Word error rate is broken"](https://www.assemblyai.com/blog/word-error-rate-is-broken)** — the clearest practitioner-level explanation of WER's blind spots and what to measure instead.
- **Wispr Flow, ["The Master Plan"](https://wisprflow.ai/post/the-master-plan)** — the category leader's own strategy writing, including their admitted sequencing mistake. Worth reading as competitive intelligence, not just inspiration.
- **Talon Voice Community Wiki** (talon.wiki) — a living, community-maintained handbook of edge cases from the most demanding voice-control users that exist; the closest thing to a canonical reference for command-mode design and accent/accuracy tuning.
- **NVIDIA NeMo-text-processing / Pynini docs** — the reference implementation approach for production-grade ITN, if you go the rule-based route recommended in Part 3.
- **whisper-streaming ("LocalAgreement" paper, arXiv:2307.14743)** — if you end up retrofitting a Whisper-family model for streaming rather than starting from a native-streaming one.

---

## Part 9 — Suggested Build Order

A phased path that front-loads the cheapest, lowest-risk wins and defers the hardest ambiguity problems until the core loop is proven:

**Phase 0 — Prove the core loop, instrumented.** VAD (Silero to start; revisit if false-positive rate is a problem) → a natively streaming ASR model (Parakeet-TDT or Apple's SpeechAnalyzer if Mac-only) → basic ITN + punctuation, no LLM yet → text insertion (accessibility API where available, keystroke fallback). Timestamp every stage. Don't touch Phase 1 until you have real latency numbers per stage.

**Phase 1 — Talk-vs-type quality.** Add a small local LLM cleanup pass (start at the 3B class, not 8–9B — per the 20s→2s lesson, bigger did not mean better here) with a light/medium/high intensity dial and per-destination-app presets, defaulting to "informal typed message" register. Keep the raw transcript one tap away.

**Phase 2 — Custom dictionary.** Ship deterministic find-and-replace first. Add fuzzy/edit-distance matching once you have real user-reported misses. Only reach for prompt/hotword biasing for a narrow, high-value word list, and regression-test it against unrelated speech before shipping.

**Phase 3 — Voice commands.** Ship hold-to-activate command mode (zero ambiguity by construction). Only invest in always-on command grammar with context-scoping if command usage becomes core to the product, and study Talon's approach closely before building your own.

**Phase 4 — Privacy hardening.** Encrypt transcripts and audio at rest (AES-256-GCM). No telemetry, no background model-fetch. Make the "never leaves your device" claim checkable by anyone with a network monitor.

**Phase 5 — Real evaluation.** Track edit-distance-after-correction and a hand-labeled jargon/proper-noun set, not raw WER, as your quality bar going forward.
