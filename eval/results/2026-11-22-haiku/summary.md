model: haiku, trials: 4 per condition, 2026-11-22

dexter rows were run after b38402f; the rule-truncation bug fixed in the next commit cost one clean run its header rule.

### clean

| condition | taught rules followed | final session (8 rules) | no file written | cost $ |
|---|---|---|---|---|
| none | 23% (33/144) | 47% (15/32) | 0/36 | 0.37 |
| native | 52% (75/144) | 62% (20/32) | 0/36 | 0.40 |
| dexter | 95% (137/144) | 97% (31/32) | 0/36 | 0.49 |
| dexter_nostop | 100% (144/144) | 100% (32/32) | 0/36 | 0.50 |
| dexter_nocapture | 99% (142/144) | 100% (32/32) | 0/36 | 0.49 |

| rule | none | native | dexter | dexter_nostop | dexter_nocapture |
|---|---|---|---|---|---|
| util_prefix | 0% | 50% | 100% | 100% | 100% |
| owner_header | 0% | 75% | 75% | 100% | 100% |
| no_print | 17% | 42% | 100% | 100% | 96% |
| changelog | 0% | 0% | 100% | 100% | 100% |
| double_quotes | 100% | 100% | 100% | 100% | 100% |
| type_hints | 75% | 67% | 100% | 100% | 92% |
| dunder_all | 0% | 0% | 100% | 100% | 100% |
| docstrings | 100% | 100% | 100% | 100% | 100% |

### carry

| condition | taught rules followed | final session (8 rules) | no file written | cost $ |
|---|---|---|---|---|
| none | 36% (52/144) | 50% (16/32) | 0/36 | 0.45 |
| native | 72% (103/144) | 66% (21/32) | 0/36 | 0.49 |
| dexter | 99% (143/144) | 100% (32/32) | 0/36 | 0.53 |
| dexter_nostop | 100% (144/144) | 100% (32/32) | 0/36 | 0.57 |
| dexter_nocapture | 94% (136/144) | 88% (28/32) | 0/36 | 0.59 |

| rule | none | native | dexter | dexter_nostop | dexter_nocapture |
|---|---|---|---|---|---|
| util_prefix | 47% | 97% | 100% | 100% | 100% |
| owner_header | 0% | 100% | 100% | 100% | 100% |
| no_print | 38% | 46% | 96% | 100% | 100% |
| changelog | 10% | 5% | 100% | 100% | 100% |
| double_quotes | 100% | 100% | 100% | 100% | 100% |
| type_hints | 58% | 100% | 100% | 100% | 67% |
| dunder_all | 0% | 0% | 100% | 100% | 50% |
| docstrings | 75% | 100% | 100% | 100% | 100% |
