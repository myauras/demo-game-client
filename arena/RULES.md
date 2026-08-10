# Arena product rules

## Reference game

- Experience reference: [MegaSmash](https://www.gachago.net/zh-tw/MegaSmash)
- Use the reference only to understand the broad interaction pattern: a large central arena, a pre-match champion prediction, an automated match, and a clear result at the end.
- Do not copy source code, artwork, advertisements, trademarks, or exact visual styling from the reference.

## Required game flow

1. Before the match, the player chooses exactly one predicted champion.
2. The match cannot start until a champion is selected.
3. After starting, all five fighters battle automatically.
4. The last fighter remaining is the champion.
5. At the end, show a result dialog naming both the selected fighter and the actual champion.
6. If the prediction is correct, prominently show the prize won. If it is incorrect, clearly show that no prize was won.
7. The result dialog may offer a new match, which returns to champion selection.

The wager and prize are simulated game values only and must not be presented as real-money gambling or a real financial payout.

## Fighters

The fixed roster is:

1. [Zed](https://op.gg/lol/champions/zed/build/mid)
2. [Jinx](https://op.gg/lol/champions/jinx/build/adc)
3. [Darius](https://op.gg/lol/champions/darius/build/top)
4. [Lee Sin](https://op.gg/lol/champions/leesin/build/jungle)
5. [Janna](https://op.gg/lol/champions/janna/build/support)

The OP.GG links are fighter reference links. Fighter names are fixed in the product UI.

## Interface constraints

- Make the arena the dominant visual area and use the available viewport efficiently.
- Keep champion selection and essential live ranking visible without shrinking the arena unnecessarily.
- Do not include participant editing.
- Do not include a rules configuration module.
- Do not include a battlefield reset control.
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
- A correct prediction shows a prize amount; an incorrect prediction shows no prize.
- Starting a new match clears the previous selection and result.
- The layout works on desktop and mobile viewports.
