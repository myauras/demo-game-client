# Arena product rules

## Reference game

- Experience reference: [MegaSmash](https://www.gachago.net/zh-tw/MegaSmash)
- Use the reference only to understand the broad interaction pattern: a large central arena, a pre-match champion prediction, an automated match, and a clear result at the end.
- Do not copy source code, artwork, advertisements, trademarks, or exact visual styling from the reference.

## Required game flow

1. Before the match, the player chooses exactly one predicted champion.
2. The match cannot start until a champion is selected.
3. After starting, all five fighters battle automatically.
4. The battle contains no items, pickups, power-ups, buffs, shields, bombs, or other collectible effects.
5. The last fighter remaining is the champion.
6. At the end, show a result dialog naming both the selected fighter and the actual champion.
7. If the prediction is correct, prominently show the prize won. If it is incorrect, clearly show that no prize was won.
8. The result dialog may offer a new match, which returns to champion selection.

The wager and prize are simulated game values only and must not be presented as real-money gambling or a real financial payout.

With five fixed fighter choices, the prediction panel treats each selection as a one-in-five chance and displays fair decimal odds of `5.00x`. A simulated `NT$ 100` entry therefore returns a gross simulated prize of `NT$ 500` when the prediction is correct.

## Fighters

The fixed roster is:

1. [Zed](https://op.gg/lol/champions/zed/build/mid)
2. [Jinx](https://op.gg/lol/champions/jinx/build/adc)
3. [Darius](https://op.gg/lol/champions/darius/build/top)
4. [Lee Sin](https://op.gg/lol/champions/leesin/build/jungle)
5. [Janna](https://op.gg/lol/champions/janna/build/support)

The OP.GG links are fighter reference links. Fighter names are fixed in the product UI.

Fighter color palettes are fixed: Zed is black (`#111318`), Jinx is RGB `0, 173, 233` (`#00ade9`), Darius is gray (`#858b94`), Lee Sin is RGB `71, 3, 5` (`#470305`), and Janna is white (`#f7f9ff`). Skill visuals use lighter and darker values from the same color family except Darius's `毀滅風暴`, whose casting ring and circular slash use a high-contrast black-and-red palette while his fighter portrait and body remain gray.

## Fighter skills

- The skill-information dialog uses these fixed names and concise descriptions:
  - Zed — `疾風殘影`: `劫召喚一位影分身一起進行戰鬥`
  - Jinx — `超威能死亡火箭`: `吉茵珂絲射出連發火箭對前方目標進行掃蕩。`
  - Darius — `毀滅風暴`: `達瑞斯揮舞他的斧頭造成致命旋風，對周圍進行大範圍擊退。`
  - Lee Sin — `虎嘯龍吟`: `李星鎖定一位目標衝刺並造成強力擊退。`
  - Janna — `颶風呼嘯`: `珍娜控制天氣，召喚一道隨時間強化的龍捲風`
- Normal fighter movement uses a fixed speed of 150 world pixels per second. Normal movement has no acceleration, random dash-speed boost, friction-based slowdown, or per-fighter speed variation. Skill movement, casting locks, stun, and knockback remain separate states.
- A normal fighter-to-fighter collision sets both fighters' knockback speed to exactly 400 world pixels per second in opposite directions. This collision knockback does not scale with impact speed or accumulated damage; skill-specific knockback values remain unchanged.
- Skill starts share a short global stagger gate: after one fighter begins a skill, no other fighter may begin a new skill for 1 second. A ready fighter waits without resetting its own cooldown, so cast announcements and effects do not all begin simultaneously.

- Jinx fires a ten-rocket volley. When a volley begins, she selects one random living opponent and keeps that same fighter locked for the entire volley. Each rocket launches 0.1 seconds after the previous one.
- Jinx waits 7 seconds after a completed or interrupted volley before the next volley can begin.
- Jinx never switches to another target during the volley. Immediately before each rocket launches, its center direction updates toward the locked fighter's current position, so the firing direction follows that fighter's movement between shots. Every rocket then independently randomizes its launch angle within a total 24-degree cone centered on that current direction (plus or minus 12 degrees).
- Jinx cannot move while the volley is being cast. A simple rotating energy ring marks the casting state.
- A collision hit against Jinx interrupts the cast, cancels all rockets not yet launched, and starts the normal skill cooldown. Rockets already in flight continue along their locked trajectories.
- After launch, every rocket flies straight without tracking or correcting its direction, so individual shots may miss. A rocket detonates on the first opposing fighter its path touches and otherwise disappears after leaving the screen.
- A hit creates a very small explosion and applies a short backward knockback only to the directly struck fighter; nearby fighters are unaffected.
- Each rocket uses a knockback impulse of 250 world pixels per second with 0.12 seconds of knockback control.
- The rocket explosion does not deal bonus damage and is a fighter skill, not an item, pickup, or collectible effect.
- Knockback from collisions or the rocket changes a fighter's velocity without flipping the direction they are facing.
- Fighters keep visible knockback momentum briefly before normal movement resumes, with a hit ring and motion trail showing who was affected.
- A fighter hit by another fighter is knocked back first, then stops completely and is stunned for 0.5 seconds. The collision keeps the existing white hit flash and adds no separate stun icon.
- A Jinx rocket hit stops its target for a 0.3-second stun after the short rocket knockback finishes.
- Stun durations never add together. When multiple stuns overlap or are queued during knockback, keep only the longest remaining duration; for example, overlapping 0.5-second and 1-second stuns resolve as 1 second.
- During ordinary movement, fighters alternate between angled pursuit and roaming toward safe points inside the arena instead of continuously charging another fighter. Pursuit is selected for roughly 40 percent of normal AI direction changes.
- Normal AI movement anticipates the arena edge and steers back inward before crossing it. Fighters can leave the arena only when collision or skill knockback carries them out.
- Each rocket explosion is deliberately small: a compact bright core, one short ring, and a few sparks at the target.
- Jinx's casting ring, rockets, trails, target marker, and explosions use her RGB `0, 173, 233` blue color family.
- Janna stops normal movement and channels for 0.5 seconds with a simple wind-energy casting ring.
- Her channel cannot be interrupted. Collision hits still apply their normal white flash, knockback, and stun, but the channel timer continues and the tornado is summoned when the full second completes.
- Janna may begin channeling whenever the skill is ready; nearby fighters do not prevent the cast.
- A completed Janna channel launches one stylized top-down spiral tornado directly from Janna's current position. At launch it locks a straight-line direction toward the center of the largest nearby group of non-Janna fighters.
- After locking its direction, the tornado moves at 100 world pixels per second without turning or stopping. It continues through the target point and starts a visible fade as soon as its center crosses the screen boundary, then is removed when that fade finishes.
- The tornado starts at a 24-world-pixel radius and grows by 12 world pixels per second after launch, up to a maximum radius of 72. Its rendered size and collision radius always use the same current radius.
- Janna is movement-locked only during the 0.5-second channel and resumes normal movement immediately after launching the tornado. Existing collision knockback can still move her without interrupting the channel.
- While both remain active, draw one very thin, low-opacity white energy line from Janna's current position to her tornado. The line follows Janna as she moves and fades out together with the tornado.
- Janna's casting ring and tornado use her white color family with pearl-gray shadows. The tornado uses simplified white neon spiral strokes with a gray eye so it resembles a vortex while matching the Arena visual style rather than looking realistic.
- Janna's tornado visual uses layered pearl-white spiral ribbons, graphite under-strokes, broken outer wind arcs, and small orbiting wind motes. It keeps a clearly visible dark eye and restrained opacity so the effect reads as a dimensional vortex without becoming a flat white disc.
- The tornado knocks back each non-Janna fighter it touches with an impulse of 400 world pixels per second, then stuns that fighter for 1 second after knockback. It never knocks back or stuns Janna herself.
- Whenever Lee Sin's skill cooldown is ready, he may select any random living opponent on the battlefield without a distance restriction and channel in place for 0.5 seconds.
- After channeling, Lee Sin tracks the selected opponent and dashes toward that fighter at 420 world pixels per second until their bodies collide.
- The dash impact sets the target's knockback velocity to 600 world pixels per second in the dash direction for 0.3 seconds. The skill has an 8-second cooldown after impact.
- Lee Sin's primary dash target is stunned for 1 second after its knockback ends.
- A fighter launched by Lee Sin passes the same 600-world-pixel-per-second knockback direction and a 1-second post-knockback stun to another fighter on contact. The original launched fighter keeps its exact flight direction and is never displaced or redirected by that collision.
- Lee Sin's casting ring, dash trail, and angular impact burst use his RGB `71, 3, 5` dark-red color family. The impact burst stays centered on Lee Sin and follows his position for its full lifetime. It has a wide grounded base, sharp side shards, and one tall central spike inspired by an arcade impact silhouette, redrawn in Arena's neon style rather than copied from a reference asset.
- Lee Sin receives no recoil or self-knockback from his dash impact or its transferred collision.
- Darius can keep moving while channeling his skill for 1.5 seconds. The channel uses a thick near-black base ring with separate vivid-red rotating arcs and cannot be interrupted by collision, knockback, or stun.
- When the channel completes, Darius releases a circular slash with a 180-world-pixel radius. Every other living fighter touched by the slash is knocked directly away from Darius with an impulse of 550 world pixels per second for 0.2 seconds, then stunned for 1 second; Darius is unaffected. The skill then enters a 6-second cooldown.
- The slash expands to its 180-world-pixel hit radius over 0.12 seconds. Throughout the visible effect, collision is evaluated against the slash's current rendered position and current rendered radius; each target can be hit at most once per slash.
- Darius's hit test uses the exact current visual slash radius with no additional fighter-radius padding. A target is hit only when its center is inside the visible slash radius, so the rendered effect size and gameplay radius always match.
- The circular slash is an original Arena-style black-and-red crescent sweep with a vivid-red blade and fast-expanding circular motion. It remains centered on Darius and follows him while visible, using the reference image only for the broad curved-slash idea.
- Darius's slash visual draws a large near-black under-sweep first, then a smaller, offset, high-saturation red blade above it. Both colors remain visibly separate instead of blending into one dark-red tint, and every layer stays inside the same current slash radius used for collision.
- When exactly one living Zed is on the battlefield, that Zed stops and channels for 1 second, then creates one additional Zed beside himself through a black-fog fade-in.
- Both Zeds belong to the same participant. While two are alive, neither can channel the skill. If either one dies, the remaining Zed may channel for 1 second and create a replacement.
- Zed's shared 12-second skill cooldown does not count down while both Zeds are alive. It starts only when the first Zed body dies; after that cooldown reaches zero, the surviving Zed may begin the 1-second replacement channel.
- Zed and his living clone do not physically collide, push, damage, or knock each other back; their bodies may pass through each other. Because AI pursuit excludes actors with the same team ID, neither Zed deliberately targets or chases the other.
- While both Zeds are alive, they keep one shared opponent target instead of roaming independently. At the start of each coordination cycle they snapshot two nearby staging positions on the arena-center side of that target, then charge together from nearly the same outward-facing direction. Those staging positions remain fixed until the charge starts, so a moving target cannot make either Zed rapidly switch between moving and stopping. Coordination destinations are clamped inside the safe arena edge, and a Zed holds at that safe point instead of alternating every frame between chasing an outside target and steering inward. A Zed that reaches its staging position first holds still instead of overshooting and repeatedly reversing direction while waiting for the other Zed. The slightly staggered staging distance lets the second collision follow the first before the target can recover and walk back toward the arena center.
- Zed is eliminated only after every living Zed belonging to that participant has died. A surviving clone still counts as Zed for champion prediction and victory settlement.
- If a Zed dies while another Zed remains alive, the defeated body dissolves through growing black fog. Only the final living Zed uses the standard out-of-bounds death animation.
- Every fighter eliminated by leaving the arena rapidly shakes first and then fades out. This animation finishes before the match declares its winner.

## Interface constraints

- The production website is published as a static export through GitHub Pages at the repository project path. All framework assets, fighter portraits, skill icons, the arena map, favicon, and social image must honor the configured public base path instead of assuming the domain root.
- Render the complete Arena interface on a fixed `1179 x 1977` portrait design surface. Center that surface and scale it uniformly to the largest size that fits inside the current browser viewport; never crop, stretch, scroll, or reflow the game based on screen size.
- Render `/arena-map-v1.png` as the battlefield background. It is an original, fully top-down hand-painted dark-fantasy carnival arena with a flat, unobstructed rust-red combat floor and detailed scenery confined to the non-playable perimeter.
- The background artwork contains no fixed glowing boundary and no purple portal circles. Draw only the engine's live shrinking boundary over the background, so the visible ring always matches the actual playable radius. That boundary is a thin cyan rune ring with a dark contrast under-stroke, moving dash marks, and small angular glyphs; it never becomes a thick solid orange ring.
- Style the surrounding controls, fighter cards, skill dialog, and result dialog with the same charcoal, rust-red, aged-bronze, warm-gold, restrained cyan, and faint violet palette as the battlefield while preserving clear text contrast and each fighter's own identity color.
- Make the arena the dominant visual area and use the available viewport efficiently.
- Do not show the Arena brand/title header or a `YOUR PICK`/selection heading. Keep the fighter choices, simulated entry, prize value, and match actions in a compact bottom control area so the battle view receives as much space as possible.
- Use a tightly framed battle world with minimal empty space around the circular arena so the arena itself, fighters, and skills appear substantially larger.
- Keep champion selection and essential live ranking visible without shrinking the arena unnecessarily.
- Keep the arena's visual shrinking behavior, but do not draw shrink countdown, energy-ring shrink, minimum-ring, percentage, or other boundary-status text over the battlefield.
- Do not draw idle copy such as `戰鬥模擬待命中` over the battlefield.
- Keep every skill immediately identifiable: Zed uses black and graphite smoke, Jinx uses her cyan-blue hair color, Darius's `毀滅風暴` uses clearly separated near-black and vivid-red layers while his body remains gray, Lee Sin uses a darker maroon red, and Janna uses white with pearl-gray structure. Avoid large neutral-white additive blooms that obscure portraits or the battlefield.
- Use the provided `/icons/<fighter>/icon.webp` portraits for fighter selection, the selected-fighter indicator, battlefield bodies, and the settled champion portrait. Preserve each fighter's existing color as the surrounding glow and border identity. Battlefield portraits are plain circles without an extra head, facing, or direction marker protruding from them.
- Every fighter selection card includes a separate skill-info button using the provided `/icons/<fighter>/skill.png` image. Activating it opens a compact, dismissible dialog with that fighter's portrait, skill icon, skill name, and one short plain-language description without changing the champion prediction. The visible description omits numerical gameplay values such as timing, angles, range, knockback, stun, and cooldown.
- While a fighter is selected before the match, show that fighter's skill icon, skill name, and concise description in a compact preview above the five fighter choices. The preview updates immediately whenever the selected fighter changes.
- Whenever a fighter begins casting a skill, add a compact notification banner at the battlefield's upper-right corner containing only that fighter's portrait, skill icon, and skill name. The newest cast enters at the top; older notices move downward and become progressively smaller. Each notice remains fully visible for 1.5 seconds, then fades and slides directly to the right without shrinking during its exit.
- Make the simulated entry and odds labels visibly larger than the fighter-card captions, with their values emphasized in a larger bold monospace style.
- Show only each fighter's name around the battlefield marker. Do not render damage percentages beneath fighters or in the victory overlay.
- Once a winner is settled, keep the captured champion snapshot fixed throughout the victory presentation; never replace it by searching the remaining actor list again.
- Normalize the settled champion through the fixed roster before rendering the victory presentation, so a winning Zed clone always displays Zed's black palette and can never appear as white Janna.
- Do not include participant editing.
- Do not include a rules configuration module.
- Do not include items or item-related visuals, controls, state, generation, collision effects, or rendering code.
- Do not include a battlefield reset control.
- During a countdown or match, provide a `回到下注` action that resets the current game and returns to champion selection; this replaces a battlefield-only reset control.
- Do not include a keyboard-shortcut panel or keyboard-control instructions.
- Do not display `自動戰鬥` explanatory copy.
- Do not display round labels such as `ROUND 01`.
- Do not display active-count labels such as `5/5 ACTIVE`.
- Avoid configuration, history, and help modals that distract from selecting a champion, watching the match, and reading the result.

## Acceptance criteria

- The roster contains exactly Zed, Jinx, Darius, Lee Sin, and Janna.
- A selected champion is visibly highlighted before starting.
- The start button is disabled until a selection exists.
- The automated battle produces one winner.
- Every fighter's normal movement is fixed at 150 world pixels per second, every standard collision knockback starts at exactly 400 world pixels per second, and the post-knockback collision stun lasts 0.5 seconds.
- Consecutive skill starts are separated by at least 1 second; fighters whose cooldowns finish together wait their turn instead of casting simultaneously.
- No item-related code or UI is shipped.
- Jinx periodically selects one random living opponent and fires ten straight rockets, 0.1 seconds apart. The locked target ID never changes during the volley, but every launch updates its center direction toward that fighter's current position before adding an independent random angle inside a total 24-degree cone; individual rockets may still miss, and a direct contact only nudges the fighter actually struck.
- Each Jinx rocket hit applies one non-stacking 0.3-second post-knockback stun, and all game stuns use the longest remaining duration rather than adding durations together.
- Fighters spend most normal movement decisions roaming within the safe arena interior, pursue with an angled approach only part of the time, and never walk across the boundary under normal AI movement.
- Janna's completed 0.5-second stationary channel launches a tornado from her own position toward the most crowded target area at 100 world pixels per second; she resumes moving immediately, a thin energy line identifies the tornado as hers, the tornado visibly fades when its center crosses the screen boundary, and each hit applies force 400 plus a 1-second post-knockback stun.
- Fighter bodies follow the fixed black, RGB `0, 173, 233` blue, gray, RGB `71, 3, 5` dark-red, and white palettes. Skill visuals match those identities except Darius's `毀滅風暴`, which uses a near-black silhouette and bright, high-saturation red blade.
- The shrinking boundary renders as a narrow cyan rune ring with an animated segmented inner line and angular glyphs, remains distinct from the rust-red map at every radius, and has no thick orange phase.
- Janna's tornado uses restrained source-over pearl-white spiral strokes instead of additive stacking, so it remains recognizable as a vortex without becoming a solid overexposed white disc.
- No `戰鬥模擬待命中` text appears in the idle battlefield.
- Lee Sin may channel for 0.5 seconds against a target at any distance, then dashes at 420 world pixels per second and hits with force 600 plus a 1-second post-knockback stun; a launched fighter transfers both effects without being displaced, reversing its flight direction, or knocking Lee Sin back. The skill cooldown is 8 seconds.
- Darius keeps moving during an uninterruptible 1.5-second channel, then releases a high-contrast black-and-red circular slash that knocks fighters within 180 world pixels away with force 550, applies a 1-second post-knockback stun, and enters a 6-second cooldown.
- Darius continuously checks the moving slash's current visual radius for its full visible lifetime, while preventing repeat hits on the same target during one slash.
- Darius's visual slash radius and hit-test radius come from the same calculation, with no hidden extra range beyond the effect.
- Janna's vortex remains readable through layered spiral ribbons and a dark center without overexposure, and Darius's separated black and vivid-red blade layers never extend past the live collision radius.
- A lone Zed channels for 1 second and creates a black-fog clone; after one body dies, a shared 12-second cooldown begins before replacement channeling is allowed. Zed remains in the match until all of his living bodies are eliminated. Two living Zeds do not collide, never select each other, and aggressively coordinate staggered charges from fixed staging points against one shared opponent without rapid movement reversals or stop-start jitter.
- Out-of-bounds fighters rapidly shake and fade before winner settlement, while a non-final Zed dissolves into black fog.
- The initial arena radius is 294 world pixels so all five fighters have more opening space.
- Fighter markers and the victory overlay do not display damage percentages, and the settled winner never visually switches to another fighter.
- All five provided fighter portraits render in selection, battle, and result contexts; battlefield portraits have no protruding direction marker, and all five provided skill icons open the matching accessible skill-information dialog with a concise, non-numeric description.
- Changing the pre-match fighter selection immediately updates the visible skill preview above the roster, and the simulated entry and odds text remain clearly legible at the fixed portrait resolution.
- Every skill cast produces exactly one upper-right battlefield banner with the caster portrait, matching skill icon, and skill name but no description. A later cast enters above the existing stack and pushes prior notices downward at a smaller scale. Each notice starts fading 1.5 seconds after it appears, keeps its current stack scale during exit, and slides directly to the right.
- A Zed victory, including a surviving clone, always uses the canonical black Zed name and palette in both the battlefield victory overlay and result dialog.
- `回到下注` clears the current match and returns to an unselected champion-prediction state.
- A correct prediction shows a prize amount; an incorrect prediction shows no prize.
- The prediction controls show `5.00x` odds derived from the fixed one-in-five chance, and the simulated `NT$ 100` entry produces a gross `NT$ 500` prize on a correct prediction.
- Starting a new match clears the previous selection and result.
- The layout works on desktop and mobile viewports.
- Desktop and mobile use the same fixed `1179 x 1977` composition, uniformly scaled so the entire interface remains visible.
- The title-free compact bottom controls leave the enlarged circular arena as the dominant element on screen.
- The generated battlefield asset exists at `/arena-map-v1.png`, fills the canvas with a centered cover crop, contains no static ring UI, and remains visible beneath the engine-rendered shrinking boundary.
- All compact UI panels use the battlefield's dark-fantasy carnival palette instead of the previous blue sci-fi grid treatment.
- A GitHub Pages production build completes as a full static export, produces `dist/client/index.html`, and keeps all public assets under the `/demo-game-client` project base path.
