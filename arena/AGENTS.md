# Arena agent instructions

Arena-specific work must begin by reading `RULES.md` completely.

- Keep all Arena implementation changes inside this folder unless the root monorepo routing rules also need updating.
- Preserve the documented pre-match champion pick, automated battle, and post-match prize-result flow.
- Keep the battle item-free. Do not add pickups, power-ups, temporary buffs, bombs, or item configuration.
- Do not restore participant editing, rule configuration, battlefield reset controls, shortcut panels, round counters, active-count badges, or explanatory auto-battle copy unless the user explicitly changes the product rules.
- Treat the external URLs in `RULES.md` as references only. Never copy proprietary code, assets, branding, or text from those sites.
