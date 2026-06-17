# Sanguosha Rules Audit

This project currently targets an arena-friendly Sanguosha subset: free-for-all survival, standard cards and heroes where implemented, and deterministic legal actions for agents. Full identity-mode victory conditions are intentionally out of scope until the arena runner supports roles.

## Sources Checked

- https://zh.wikipedia.org/wiki/%E4%B8%89%E5%9B%BD%E6%9D%80
- https://zh.wikipedia.org/wiki/%E4%B8%89%E5%9C%8B%E6%AE%BA%E6%A8%99%E6%BA%96%E7%89%88

## Implemented And Covered

- [x] Standard multiplayer shape: the engine accepts 2-N players.
- [x] Turn structure: draw, play, discard, end.
- [x] `杀`: single target, non-self target, distance check, one use per turn unless `诸葛连弩`.
- [x] `闪`: response to `杀`.
- [x] `桃`: play-phase heal and dying rescue.
- [x] Circular seat distance with +1/-1 horse modifiers.
- [x] Dead players are skipped in turns and distance.
- [x] Free-for-all arena victory: last living player wins.
- [x] `决斗`: target responds first, both sides alternate `杀`, first failure takes damage.
- [x] `南蛮入侵` and `万箭齐发`: resolve against each other living player in seat order.
- [x] `无中生有`: draw 2 cards.
- [x] 曹操「奸雄」: on damage, gain the actual card that caused the damage.
- [x] 孙权「制衡」: discard selected hand cards and draw the same count.
- [x] 关羽「武圣」: red non-equipment cards can be used/responded as `杀`.
- [x] 甄姬「洛神」: turn-start black judgments go to hand until first red card.

## Known Rule Gaps

- [ ] 刘备「仁德」active skill is still a stub.
- [ ] `无懈可击` and response windows for trick cancellation are missing.
- [ ] Delayed tricks and judgment area are missing.
- [ ] Many equipment effects are not implemented beyond horses and `诸葛连弩`.
- [ ] Identity-mode roles, rewards, penalties, and role victory conditions are not implemented.
- [ ] Skill timing is still coarse; later work should replace raw event hooks with named timing windows.
- [ ] Some standard cards are missing, including discard/steal trick cards and additional equipment.

## Arena Decisions

- Use free-for-all survival for early LLM arena matches. It is simpler to evaluate and does not leak hidden role information into prompts.
- Keep `legalActions(playerId)` as the source of truth. UI, bots, and future LLM agents should never synthesize moves that bypass it.
- Prefer one small rule patch plus tests at a time. Every rule bug can otherwise poison replay data and make agent comparisons hard to trust.
