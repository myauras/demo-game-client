# Game repository routing

This repository is a monorepo containing multiple games. Before changing code:

1. Identify which game the request targets from the user's wording and the file paths involved.
2. Work only inside that game's folder unless a repository-wide change is explicitly required.
3. Check the target game folder for `AGENTS.md`, `RULES.md`, or another clearly named rules document before planning or editing.
4. Treat the closest game-level instructions and rules as authoritative for that game.
5. If the target game is `arena`, read `arena/AGENTS.md` and `arena/RULES.md` completely before making changes.

Do not copy one game's product rules, dependencies, assets, or UI conventions into another game unless the user explicitly requests it.
